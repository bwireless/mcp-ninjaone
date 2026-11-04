import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NinjaOneClient } from "../ninjaone-client.js";
import { buildDeviceFilter, deviceFilter, deviceId } from "./devices.js";
import { errorResult, jsonResult, textResult } from "./util.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

const severity = z
  .enum(["NONE", "MINOR", "MODERATE", "MAJOR", "CRITICAL"])
  .optional()
  .describe("Only return alerts with this severity");

interface Alert {
  severity?: string;
  [key: string]: unknown;
}

function filterBySeverity(alerts: unknown, wanted?: string): unknown {
  if (!wanted || !Array.isArray(alerts)) return alerts;
  return (alerts as Alert[]).filter(
    (a) => (a.severity ?? "").toUpperCase() === wanted,
  );
}

export function registerAlertTools(server: McpServer, client: NinjaOneClient) {
  server.registerTool(
    "list_alerts",
    {
      title: "List alerts",
      description:
        "List active (triggered) alerts across all devices. Returns alert UID, device, severity, priority, condition name, message, and creation time.",
      inputSchema: {
        severity,
        organization_id: z
          .number()
          .int()
          .optional()
          .describe("Only return alerts for devices in this organization"),
        device_filter: deviceFilter,
        source_type: z
          .string()
          .optional()
          .describe(
            "Filter by alert source type, e.g. AGENT_OFFLINE, CONDITION_AGENT_CPU, CONDITION_AGENT_DISK_FREE_SPACE, CONDITION_WINDOWS_SERVICE_STATE_CHANGED",
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ severity, organization_id, device_filter, source_type }) => {
      try {
        const results = await client.get("/alerts", {
          df: buildDeviceFilter(device_filter, organization_id),
          sourceType: source_type,
        });
        return jsonResult(filterBySeverity(results, severity));
      } catch (error) {
        return errorResult("listing alerts", error);
      }
    },
  );

  server.registerTool(
    "list_device_alerts",
    {
      title: "List device alerts",
      description: "List all active alerts for a specific device.",
      inputSchema: { device_id: deviceId, severity },
      annotations: READ_ONLY,
    },
    async ({ device_id, severity }) => {
      try {
        const results = await client.get(`/device/${device_id}/alerts`);
        return jsonResult(filterBySeverity(results, severity));
      } catch (error) {
        return errorResult("listing device alerts", error);
      }
    },
  );

  server.registerTool(
    "reset_alert",
    {
      title: "Reset alert",
      description:
        "Reset (acknowledge and clear) an active alert by its UID. Use list_alerts or list_device_alerts to find the UID. If the underlying condition is still present the alert may re-trigger.",
      inputSchema: {
        alert_uid: z
          .string()
          .min(1)
          .describe("The unique identifier (UID) of the alert to reset"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ alert_uid }) => {
      try {
        await client.delete(`/alert/${encodeURIComponent(alert_uid)}`);
        return textResult(`Alert ${alert_uid} has been reset successfully.`);
      } catch (error) {
        return errorResult("resetting alert", error);
      }
    },
  );
}
