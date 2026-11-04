import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NinjaOneClient } from "../ninjaone-client.js";
import { buildDeviceFilter, deviceFilter, deviceId } from "./devices.js";
import { errorResult, jsonResult, textResult } from "./util.js";

interface DeviceSummary {
  id: number;
  displayName?: string;
  systemName?: string;
  organizationId?: number;
  maintenance?: {
    status?: string;
    start?: number;
    end?: number;
    reasonMessage?: string;
  };
}

const PAGE_SIZE = 1000;

function iso(seconds?: number): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
}

export function registerMaintenanceTools(server: McpServer, client: NinjaOneClient) {
  server.registerTool(
    "list_maintenance_windows",
    {
      title: "List maintenance windows",
      description:
        "List devices that are currently in, or scheduled for, maintenance mode, with their maintenance status, start/end time, and reason. Scans the device list (optionally limited by organization or device filter).",
      inputSchema: {
        organization_id: z
          .number()
          .int()
          .optional()
          .describe("Only check devices in this organization"),
        device_filter: deviceFilter,
        max_devices: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .default(10_000)
          .describe("Maximum number of devices to scan"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ organization_id, device_filter, max_devices }) => {
      try {
        const df = buildDeviceFilter(device_filter, organization_id);
        const inMaintenance: DeviceSummary[] = [];
        let after: number | undefined;
        let scanned = 0;

        while (scanned < max_devices) {
          const pageSize = Math.min(PAGE_SIZE, max_devices - scanned);
          const page = (await client.get("/devices", { df, pageSize, after })) as DeviceSummary[];
          if (!Array.isArray(page) || page.length === 0) break;
          scanned += page.length;
          for (const d of page) if (d.maintenance) inMaintenance.push(d);
          if (page.length < pageSize) break;
          after = page[page.length - 1].id;
        }

        return jsonResult({
          devicesScanned: scanned,
          count: inMaintenance.length,
          devices: inMaintenance.map((d) => ({
            deviceId: d.id,
            name: d.displayName ?? d.systemName,
            organizationId: d.organizationId,
            status: d.maintenance?.status,
            start: iso(d.maintenance?.start),
            end: iso(d.maintenance?.end),
            reason: d.maintenance?.reasonMessage,
          })),
        });
      } catch (error) {
        return errorResult("listing maintenance windows", error);
      }
    },
  );

  server.registerTool(
    "create_maintenance_window",
    {
      title: "Create maintenance window",
      description:
        "Put a device into maintenance mode for a time window, suppressing alerts (and optionally patching, AV scans, and scheduled tasks). Provide either `end` or `duration_minutes`. `start` defaults to now.",
      inputSchema: {
        device_id: deviceId,
        start: z
          .number()
          .optional()
          .describe("Start time as a Unix timestamp in seconds. Defaults to now."),
        end: z
          .number()
          .optional()
          .describe("End time as a Unix timestamp in seconds."),
        duration_minutes: z
          .number()
          .positive()
          .optional()
          .describe("Length of the window in minutes (alternative to `end`)."),
        disabled_features: z
          .array(z.enum(["ALERTS", "PATCHING", "AVSCANS", "TASKS"]))
          .min(1)
          .optional()
          .default(["ALERTS"])
          .describe("Features to suspend during the window"),
        reason: z.string().optional().describe("Reason message shown in NinjaOne"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ device_id, start, end, duration_minutes, disabled_features, reason }) => {
      const startSec = start ?? Math.floor(Date.now() / 1000);
      const endSec =
        end ?? (duration_minutes !== undefined ? startSec + Math.round(duration_minutes * 60) : undefined);

      if (endSec === undefined) {
        return errorResult("creating maintenance window", "Provide either `end` or `duration_minutes`.");
      }
      if (endSec <= startSec) {
        return errorResult("creating maintenance window", "`end` must be after `start`.");
      }

      try {
        const body: Record<string, unknown> = {
          start: startSec,
          end: endSec,
          disabledFeatures: disabled_features,
        };
        if (reason) body.reasonMessage = reason;
        await client.put(`/device/${device_id}/maintenance`, body);
        return textResult(
          [
            `Maintenance window scheduled for device ${device_id}.`,
            `Start: ${iso(startSec)}`,
            `End: ${iso(endSec)}`,
            `Disabled features: ${disabled_features.join(", ")}`,
            reason ? `Reason: ${reason}` : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (error) {
        return errorResult("creating maintenance window", error);
      }
    },
  );

  server.registerTool(
    "cancel_device_maintenance",
    {
      title: "Cancel device maintenance",
      description: "End or cancel maintenance mode for a device, immediately re-enabling alerting.",
      inputSchema: { device_id: deviceId },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ device_id }) => {
      try {
        await client.delete(`/device/${device_id}/maintenance`);
        return textResult(`Maintenance cancelled for device ${device_id}. Alerting is re-enabled.`);
      } catch (error) {
        return errorResult("cancelling maintenance window", error);
      }
    },
  );
}
