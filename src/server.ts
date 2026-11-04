import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NinjaOneClient } from "./ninjaone-client.js";
import { registerDeviceTools } from "./tools/devices.js";
import { registerOrganizationTools } from "./tools/organizations.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerMaintenanceTools } from "./tools/maintenance.js";
import { registerJobTools } from "./tools/jobs.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const SERVER_VERSION = pkg.version;

export function createServer(client: NinjaOneClient): McpServer {
  const server = new McpServer({ name: "ninjaone", version: SERVER_VERSION });

  registerDeviceTools(server, client);
  registerOrganizationTools(server, client);
  registerAlertTools(server, client);
  registerMaintenanceTools(server, client);
  registerJobTools(server, client);

  return server;
}
