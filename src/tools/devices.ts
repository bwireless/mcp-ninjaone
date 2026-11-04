import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NinjaOneClient } from "../ninjaone-client.js";
import { errorResult, jsonResult } from "./util.js";

export const deviceId = z.number().int().positive().describe("NinjaOne device ID");

export const deviceFilter = z
  .string()
  .optional()
  .describe(
    "NinjaOne device filter (df) expression, e.g. 'org = 123', 'class = WINDOWS_SERVER', 'offline', or 'org = 1 AND status = APPROVED'",
  );

/** Combine an organization ID with an optional df expression. */
export function buildDeviceFilter(
  filter?: string,
  organizationId?: number,
): string | undefined {
  const parts: string[] = [];
  if (organizationId !== undefined) parts.push(`org = ${organizationId}`);
  if (filter?.trim()) parts.push(filter.trim());
  return parts.length ? parts.join(" AND ") : undefined;
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerDeviceTools(server: McpServer, client: NinjaOneClient) {
  server.registerTool(
    "list_devices",
    {
      title: "List devices",
      description:
        "List devices managed by NinjaOne. Returns device ID, name, node class, online/offline status, organization, maintenance status, and last contact time. Paginate by passing the last device ID returned as `after`.",
      inputSchema: {
        organization_id: z
          .number()
          .int()
          .optional()
          .describe("Only return devices belonging to this organization ID"),
        device_filter: deviceFilter,
        page_size: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(100)
          .describe("Number of devices to return (max 1000)"),
        after: z
          .number()
          .int()
          .optional()
          .describe("Return devices with an ID greater than this (pagination cursor)"),
      },
      annotations: READ_ONLY,
    },
    async ({ organization_id, device_filter, page_size, after }) => {
      try {
        const results = await client.get("/devices", {
          df: buildDeviceFilter(device_filter, organization_id),
          pageSize: page_size,
          after,
        });
        return jsonResult(results);
      } catch (error) {
        return errorResult("listing devices", error);
      }
    },
  );

  server.registerTool(
    "get_device",
    {
      title: "Get device",
      description:
        "Get detailed information about a device, including OS, system/hardware, memory, processors, volumes, IP/MAC addresses, last logged-in user, and maintenance status.",
      inputSchema: { device_id: deviceId },
      annotations: READ_ONLY,
    },
    async ({ device_id }) => {
      try {
        return jsonResult(await client.get(`/device/${device_id}`));
      } catch (error) {
        return errorResult("fetching device", error);
      }
    },
  );

  server.registerTool(
    "get_device_activities",
    {
      title: "Get device activities",
      description:
        "Get the activity log for a device (alerts triggered, scripts run, patches, status changes). Newest first. To page back in time, pass the lowest activity ID returned as `older_than`.",
      inputSchema: {
        device_id: deviceId,
        page_size: z
          .number()
          .int()
          .min(10)
          .max(1000)
          .optional()
          .default(50)
          .describe("Number of activity entries to return (10-1000)"),
        older_than: z
          .number()
          .int()
          .optional()
          .describe("Only return activities older than this activity ID"),
        newer_than: z
          .number()
          .int()
          .optional()
          .describe("Only return activities newer than this activity ID"),
        activity_type: z
          .string()
          .optional()
          .describe("Filter by activity type, e.g. CONDITION, ACTION, PATCH_MANAGEMENT, SCRIPTING, SYSTEM"),
        status: z
          .string()
          .optional()
          .describe("Filter by activity status"),
        start_time: z
          .string()
          .optional()
          .describe("Only return activities after this time (ISO-8601, e.g. 2025-01-31T00:00:00Z)"),
        end_time: z
          .string()
          .optional()
          .describe("Only return activities before this time (ISO-8601)"),
      },
      annotations: READ_ONLY,
    },
    async ({
      device_id,
      page_size,
      older_than,
      newer_than,
      activity_type,
      status,
      start_time,
      end_time,
    }) => {
      try {
        const results = await client.get(`/device/${device_id}/activities`, {
          pageSize: page_size,
          olderThan: older_than,
          newerThan: newer_than,
          activityType: activity_type,
          status,
          startTime: start_time,
          endTime: end_time,
        });
        return jsonResult(results);
      } catch (error) {
        return errorResult("fetching device activities", error);
      }
    },
  );

  server.registerTool(
    "get_device_os_patch_status",
    {
      title: "Get device OS patch status",
      description:
        "Get OS patch status for a device: pending/approved/rejected patches that are not yet installed, plus the patch installation history (installed and failed).",
      inputSchema: {
        device_id: deviceId,
        pending_status: z
          .string()
          .optional()
          .describe("Filter pending patches by status, e.g. MANUAL, APPROVED, REJECTED"),
        install_status: z
          .enum(["INSTALLED", "FAILED"])
          .optional()
          .describe("Filter installation history by result"),
      },
      annotations: READ_ONLY,
    },
    async ({ device_id, pending_status, install_status }) => {
      try {
        const [pending, installs] = await Promise.all([
          client.get(`/device/${device_id}/os-patches`, { status: pending_status }),
          client.get(`/device/${device_id}/os-patch-installs`, { status: install_status }),
        ]);
        return jsonResult({ pending, installs });
      } catch (error) {
        return errorResult("fetching OS patch status", error);
      }
    },
  );

  const simpleGetters: Array<[string, string, string, string, string]> = [
    [
      "get_device_software",
      "Get device software",
      "Get the list of installed software on a device.",
      "software",
      "fetching device software",
    ],
    [
      "get_device_processor_info",
      "Get device processors",
      "Get CPU/processor information for a device.",
      "processors",
      "fetching processor info",
    ],
    [
      "get_device_disks",
      "Get device disks",
      "Get physical disk drive information for a device (model, size, media type, health status).",
      "disks",
      "fetching disk info",
    ],
    [
      "get_device_volumes",
      "Get device volumes",
      "Get disk volume/partition information for a device, including capacity, free space, and BitLocker status.",
      "volumes",
      "fetching volume info",
    ],
  ];

  for (const [name, title, description, subpath, context] of simpleGetters) {
    server.registerTool(
      name,
      { title, description, inputSchema: { device_id: deviceId }, annotations: READ_ONLY },
      async ({ device_id }) => {
        try {
          return jsonResult(await client.get(`/device/${device_id}/${subpath}`));
        } catch (error) {
          return errorResult(context, error);
        }
      },
    );
  }
}
