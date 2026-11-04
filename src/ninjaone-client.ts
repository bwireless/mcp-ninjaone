export interface NinjaOneConfig {
  clientId: string;
  clientSecret: string;
  /** Instance hostname, e.g. "app.ninjarmm.com". A full URL is also accepted. */
  instance: string;
  /** Space-separated OAuth scopes. Defaults to "monitoring management control". */
  scope?: string;
  /** Per-request timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export const DEFAULT_SCOPE = "monitoring management control";

export class NinjaOneApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "NinjaOneApiError";
  }
}

/** Accepts "app.ninjarmm.com", "https://app.ninjarmm.com/", etc. and returns the bare host. */
export function normalizeInstance(instance: string): string {
  return instance
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

export class NinjaOneClient {
  private readonly origin: string;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly scope: string;
  private readonly timeoutMs: number;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly config: NinjaOneConfig) {
    const host = normalizeInstance(config.instance);
    if (!host) throw new Error("NinjaOne instance hostname is empty");
    this.origin = `https://${host}`;
    this.baseUrl = `${this.origin}/v2`;
    this.tokenUrl = `${this.origin}/ws/oauth/token`;
    this.scope = config.scope?.trim() || DEFAULT_SCOPE;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.scope,
    });

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new NinjaOneApiError(
        response.status,
        errorText,
        `NinjaOne OAuth error (${response.status}): ${errorText}`,
      );
    }

    const token = (await response.json()) as TokenResponse;
    if (!token.access_token) {
      throw new Error("NinjaOne OAuth response did not contain an access_token");
    }
    this.accessToken = token.access_token;
    this.tokenExpiresAt = Date.now() + (token.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.accessToken &&
      Date.now() < this.tokenExpiresAt - 60_000
    ) {
      return this.accessToken;
    }
    // De-duplicate concurrent token requests.
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    params?: QueryParams,
  ): Promise<unknown> {
    const url = this.buildUrl(path, params);

    const send = async (token: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return fetch(url, init);
    };

    let response = await send(await this.getAccessToken());
    // Token may have been revoked or expired early — refresh once and retry.
    if (response.status === 401) {
      response = await send(await this.getAccessToken(true));
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new NinjaOneApiError(
        response.status,
        errorText,
        `NinjaOne API error (${response.status} ${method} ${path}): ${errorText || response.statusText}`,
      );
    }

    if (response.status === 204) return null;

    const text = await response.text();
    if (!text) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      return JSON.parse(text);
    }
    return text;
  }

  get(path: string, params?: QueryParams): Promise<unknown> {
    return this.request("GET", path, undefined, params);
  }

  post(path: string, data?: unknown, params?: QueryParams): Promise<unknown> {
    return this.request("POST", path, data, params);
  }

  put(path: string, data?: unknown, params?: QueryParams): Promise<unknown> {
    return this.request("PUT", path, data, params);
  }

  patch(path: string, data?: unknown): Promise<unknown> {
    return this.request("PATCH", path, data);
  }

  delete(path: string, params?: QueryParams): Promise<unknown> {
    return this.request("DELETE", path, undefined, params);
  }
}
