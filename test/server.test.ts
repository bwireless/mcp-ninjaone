import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NinjaOneClient, normalizeInstance } from "../src/ninjaone-client.js";
import { createServer } from "../src/server.js";

// ── Fake NinjaOne API ──────────────────────────────────────────────────

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  auth?: string;
}

type Responder = (call: Call) => { status?: number; json?: unknown; text?: string } | undefined;

let calls: Call[] = [];
let responder: Responder = () => undefined;
let tokenCount = 0;
let tokenBodies: URLSearchParams[] = [];
const realFetch = globalThis.fetch;

function installFakeFetch() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.host, "app.ninjarmm.com");
    const method = init?.method ?? "GET";

    if (url.pathname === "/ws/oauth/token") {
      tokenCount++;
      tokenBodies.push(new URLSearchParams(String(init?.body)));
      return Response.json({ access_token: `tok-${tokenCount}`, token_type: "bearer", expires_in: 3600 });
    }

    const headers = new Headers(init?.headers);
    const call: Call = {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("authorization") ?? undefined,
    };
    calls.push(call);

    const r = responder(call);
    if (!r) return new Response(null, { status: 204 });
    if (r.text !== undefined) return new Response(r.text, { status: r.status ?? 200 });
    return Response.json(r.json ?? null, { status: r.status ?? 200 });
  }) as typeof fetch;
}

// ── MCP client wiring ──────────────────────────────────────────────────

let mcp: Client;

before(async () => {
  installFakeFetch();
  const ninja = new NinjaOneClient({
    clientId: "id",
    clientSecret: "secret",
    instance: "https://app.ninjarmm.com/",
  });
  const server = createServer(ninja);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientT);
});

after(async () => {
  await mcp.close();
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  responder = () => undefined;
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await mcp.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { text: res.content[0]?.text ?? "", isError: !!res.isError };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("normalizeInstance", () => {
  it("strips scheme and path", () => {
    assert.equal(normalizeInstance("https://eu.ninjarmm.com/"), "eu.ninjarmm.com");
    assert.equal(normalizeInstance(" app.ninjarmm.com "), "app.ninjarmm.com");
  });
});

describe("tool registration", () => {
  it("exposes every tool with annotations", async () => {
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "cancel_device_maintenance",
      "create_maintenance_window",
      "get_device",
      "get_device_activities",
      "get_device_disks",
      "get_device_jobs",
      "get_device_os_patch_status",
      "get_device_processor_info",
      "get_device_scripting_options",
      "get_device_software",
      "get_device_volumes",
      "get_organization",
      "get_organization_locations",
      "get_organization_policies",
      "list_alerts",
      "list_device_alerts",
      "list_devices",
      "list_maintenance_windows",
      "list_organization_devices",
      "list_organizations",
      "list_policies",
      "list_running_jobs",
      "reset_alert",
      "run_script_on_device",
    ]);
    for (const t of tools) assert.ok(t.annotations, `${t.name} missing annotations`);
  });
});

describe("auth", () => {
  it("requests the default scopes without offline_access and caches the token", async () => {
    await call("get_device", { device_id: 1 });
    await call("get_device", { device_id: 2 });
    const scope = tokenBodies[0].get("scope");
    assert.equal(scope, "monitoring management control");
    assert.equal(tokenBodies[0].get("grant_type"), "client_credentials");
    assert.equal(calls[0].auth, calls[1].auth);
  });

  it("refreshes the token once on 401", async () => {
    let first = true;
    responder = () => {
      if (first) {
        first = false;
        return { status: 401, text: "expired" };
      }
      return { json: { id: 5 } };
    };
    const before = tokenCount;
    const r = await call("get_device", { device_id: 5 });
    assert.equal(r.isError, false);
    assert.equal(tokenCount, before + 1);
    assert.notEqual(calls[0].auth, calls[1].auth);
  });
});

describe("devices", () => {
  it("list_devices maps organization_id to a df filter", async () => {
    responder = () => ({ json: [{ id: 1 }] });
    await call("list_devices", { organization_id: 7, device_filter: "offline", page_size: 50, after: 10 });
    assert.equal(calls[0].path, "/v2/devices");
    assert.deepEqual(calls[0].query, { df: "org = 7 AND offline", pageSize: "50", after: "10" });
  });

  it("get_device_activities uses olderThan/newerThan", async () => {
    await call("get_device_activities", { device_id: 3, older_than: 99, activity_type: "ACTION" });
    assert.equal(calls[0].path, "/v2/device/3/activities");
    assert.deepEqual(calls[0].query, { pageSize: "50", olderThan: "99", activityType: "ACTION" });
  });

  it("get_device_os_patch_status combines pending and installed patches", async () => {
    responder = (c) => ({ json: c.path.endsWith("os-patches") ? ["pending"] : ["installed"] });
    const r = await call("get_device_os_patch_status", { device_id: 4 });
    assert.deepEqual(JSON.parse(r.text), { pending: ["pending"], installs: ["installed"] });
    assert.deepEqual(calls.map((c) => c.path).sort(), ["/v2/device/4/os-patch-installs", "/v2/device/4/os-patches"]);
  });

  for (const [tool, sub] of [
    ["get_device_software", "software"],
    ["get_device_processor_info", "processors"],
    ["get_device_disks", "disks"],
    ["get_device_volumes", "volumes"],
  ]) {
    it(`${tool} -> /device/{id}/${sub}`, async () => {
      await call(tool, { device_id: 9 });
      assert.equal(calls[0].path, `/v2/device/9/${sub}`);
    });
  }

  it("rejects invalid device ids", async () => {
    const r = await call("get_device", { device_id: -1 });
    assert.equal(r.isError, true);
    assert.equal(calls.length, 0);
  });
});

describe("organizations", () => {
  it("get_organization_policies resolves policy names", async () => {
    responder = (c) =>
      c.path === "/v2/policies"
        ? { json: [{ id: 11, name: "Servers", nodeClass: "WINDOWS_SERVER" }] }
        : { json: { id: 2, name: "Acme", policies: [{ nodeRoleId: 1, policyId: 11 }] } };
    const r = await call("get_organization_policies", { organization_id: 2 });
    const parsed = JSON.parse(r.text);
    assert.equal(parsed.organizationName, "Acme");
    assert.equal(parsed.policies[0].policyName, "Servers");
  });

  it("list_organization_devices paginates", async () => {
    await call("list_organization_devices", { organization_id: 2, after: 5 });
    assert.equal(calls[0].path, "/v2/organization/2/devices");
    assert.deepEqual(calls[0].query, { pageSize: "100", after: "5" });
  });
});

describe("alerts", () => {
  it("list_alerts filters severity client-side and only sends supported params", async () => {
    responder = () => ({ json: [{ uid: "a", severity: "CRITICAL" }, { uid: "b", severity: "MINOR" }] });
    const r = await call("list_alerts", { severity: "CRITICAL", organization_id: 3 });
    assert.deepEqual(calls[0].query, { df: "org = 3" });
    assert.deepEqual(JSON.parse(r.text), [{ uid: "a", severity: "CRITICAL" }]);
  });

  it("reset_alert DELETEs and encodes the uid", async () => {
    await call("reset_alert", { alert_uid: "abc/def" });
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].path, "/v2/alert/abc%2Fdef");
  });

  it("surfaces API errors as tool errors", async () => {
    responder = () => ({ status: 403, text: "forbidden" });
    const r = await call("list_alerts");
    assert.equal(r.isError, true);
    assert.match(r.text, /403/);
  });
});

describe("maintenance", () => {
  it("list_maintenance_windows pages devices and filters", async () => {
    responder = (c) => {
      if (c.query.after) {
        return { json: [{ id: 1001, displayName: "c", maintenance: { status: "PENDING", start: 0, end: 60 } }] };
      }
      const page = Array.from({ length: Number(c.query.pageSize) }, (_, i) => ({ id: i + 1 }));
      (page[1] as Record<string, unknown>).maintenance = { status: "IN_MAINTENANCE", start: 0, end: 60 };
      return { json: page };
    };
    const r = await call("list_maintenance_windows", { max_devices: 1001 });
    const parsed = JSON.parse(r.text);
    assert.equal(parsed.devicesScanned, 1001);
    assert.equal(parsed.count, 2);
    assert.equal(parsed.devices[0].end, "1970-01-01T00:01:00.000Z");
    assert.deepEqual(calls.map((c) => c.query), [{ pageSize: "1000" }, { pageSize: "1", after: "1000" }]);
  });

  it("create_maintenance_window sends the documented body", async () => {
    await call("create_maintenance_window", { device_id: 8, start: 1000, duration_minutes: 60, reason: "patching" });
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[0].path, "/v2/device/8/maintenance");
    assert.deepEqual(calls[0].body, { start: 1000, end: 4600, disabledFeatures: ["ALERTS"], reasonMessage: "patching" });
  });

  it("create_maintenance_window validates the window", async () => {
    assert.equal((await call("create_maintenance_window", { device_id: 8 })).isError, true);
    assert.equal((await call("create_maintenance_window", { device_id: 8, start: 10, end: 5 })).isError, true);
    assert.equal(calls.length, 0);
  });

  it("cancel_device_maintenance DELETEs", async () => {
    await call("cancel_device_maintenance", { device_id: 8 });
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].path, "/v2/device/8/maintenance");
  });
});

describe("jobs & scripting", () => {
  it("list_running_jobs passes jobType and df", async () => {
    await call("list_running_jobs", { job_type: "SCRIPTING", device_filter: "org = 1" });
    assert.deepEqual(calls[0].query, { jobType: "SCRIPTING", df: "org = 1" });
  });

  it("run_script_on_device sends type SCRIPT and runAs", async () => {
    await call("run_script_on_device", { device_id: 6, script_id: 42, parameters: "-Force" });
    assert.equal(calls[0].path, "/v2/device/6/script/run");
    assert.deepEqual(calls[0].body, { type: "SCRIPT", id: 42, runAs: "system", parameters: "-Force" });
  });

  it("run_script_on_device supports built-in actions", async () => {
    await call("run_script_on_device", { device_id: 6, action_uid: "u-1", run_as: "loggedonuser" });
    assert.deepEqual(calls[0].body, { type: "ACTION", uid: "u-1", runAs: "loggedonuser" });
  });

  it("run_script_on_device requires exactly one target", async () => {
    assert.equal((await call("run_script_on_device", { device_id: 6 })).isError, true);
    assert.equal((await call("run_script_on_device", { device_id: 6, script_id: 1, action_uid: "x" })).isError, true);
    assert.equal(calls.length, 0);
  });

  it("get_device_scripting_options filters by name", async () => {
    responder = () => ({ json: { scripts: [{ name: "Disk Cleanup" }, { name: "Reboot" }], credentials: { roles: [] } } });
    const r = await call("get_device_scripting_options", { device_id: 6, name_contains: "disk" });
    assert.deepEqual(JSON.parse(r.text).scripts, [{ name: "Disk Cleanup" }]);
  });
});
