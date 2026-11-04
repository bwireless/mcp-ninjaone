#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NinjaOneClient } from "./ninjaone-client.js";
import { createServer } from "./server.js";

function getConfig() {
  const clientId = process.env.NINJAONE_CLIENT_ID;
  const clientSecret = process.env.NINJAONE_CLIENT_SECRET;
  const instance = process.env.NINJAONE_INSTANCE;

  const missing = [
    !clientId && "NINJAONE_CLIENT_ID",
    !clientSecret && "NINJAONE_CLIENT_SECRET",
    !instance && "NINJAONE_INSTANCE",
  ].filter(Boolean);

  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const timeout = Number(process.env.NINJAONE_TIMEOUT_MS);

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    instance: instance!,
    scope: process.env.NINJAONE_SCOPE,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
  };
}

async function main() {
  const client = new NinjaOneClient(getConfig());
  const server = createServer(client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for the MCP protocol; log to stderr only.
  console.error("NinjaOne MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
