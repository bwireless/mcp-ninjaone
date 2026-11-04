import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NinjaOneClient } from "../ninjaone-client.js";
import { buildDeviceFilter, deviceFilter, deviceId } from "./devices.js";
import { errorResult, jsonResult, textResult } from "./util.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

const jobType = z
  .string()
  .optional()
  .describe("Filter by job type, e.g. SCRIPTING, ACTION, PATCH_MANAGEMENT, SOFTWARE_PATCH_MANAGEMENT, ANTIVIRUS, MAINTENANCE_MODE");

export function registerJobTools(server: McpServer, client: NinjaOneClient) {
  server.registerTool(
    "list_running_jobs",
    {
      title: "List running jobs",
      description:
        "List jobs currently running across devices (scripts, patch installs, actions, and other automated operations).",
      inputSchema: {
        organization_id: z
          .number()
          .int()
          .optional()
          .describe("Only return jobs for devices in this organization"),
        device_filter: deviceFilter,
        job_type: jobType,
      },
      annotations: READ_ONLY,
    },
    async ({ organization_id, device_filter, job_type }) => {
      try {
        return jsonResult(
          await client.get("/jobs", {
            df: buildDeviceFilter(device_filter, organization_id),
            jobType: job_type,
          }),
        );
      } catch (error) {
        return errorResult("listing running jobs", error);
      }
    },
  );

  server.registerTool(
    "get_device_jobs",
    {
      title: "Get device jobs",
      description: "Get jobs currently running on a specific device.",
      inputSchema: { device_id: deviceId },
      annotations: READ_ONLY,
    },
    async ({ device_id }) => {
      try {
        return jsonResult(await client.get(`/device/${device_id}/jobs`));
      } catch (error) {
        return errorResult("fetching device jobs", error);
      }
    },
  );

  server.registerTool(
    "get_device_scripting_options",
    {
      title: "Get device scripting options",
      description:
        "List the scripts and built-in actions that can be run on a device, plus the available run-as credential roles. Use this to find the `script_id` (for scripts) or `action_uid` (for built-in actions) and `run_as` value for run_script_on_device.",
      inputSchema: {
        device_id: deviceId,
        name_contains: z
          .string()
          .optional()
          .describe("Only return scripts whose name contains this text (case-insensitive)"),
      },
      annotations: READ_ONLY,
    },
    async ({ device_id, name_contains }) => {
      try {
        const options = (await client.get(`/device/${device_id}/scripting/options`)) as {
          scripts?: Array<{ name?: string }>;
          [key: string]: unknown;
        };
        if (name_contains && Array.isArray(options?.scripts)) {
          const needle = name_contains.toLowerCase();
          options.scripts = options.scripts.filter((s) =>
            (s.name ?? "").toLowerCase().includes(needle),
          );
        }
        return jsonResult(options);
      } catch (error) {
        return errorResult("fetching scripting options", error);
      }
    },
  );

  server.registerTool(
    "run_script_on_device",
    {
      title: "Run script on device",
      description:
        "Run a saved script (by `script_id`) or a built-in action (by `action_uid`) on a device. Use get_device_scripting_options first to find valid IDs and run-as roles. This executes code on the endpoint.",
      inputSchema: {
        device_id: deviceId,
        script_id: z
          .number()
          .int()
          .optional()
          .describe("ID of a saved script from the script library"),
        action_uid: z
          .string()
          .optional()
          .describe("UID of a built-in action (use instead of script_id)"),
        run_as: z
          .string()
          .optional()
          .default("system")
          .describe(
            "Run-as context: 'system', 'loggedonuser', or a credential role from get_device_scripting_options (e.g. SR_LOCAL_ADMINISTRATOR, SR_DOMAIN_ADMINISTRATOR)",
          ),
        parameters: z
          .string()
          .optional()
          .describe("Parameter string passed to the script"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ device_id, script_id, action_uid, run_as, parameters }) => {
      if ((script_id === undefined) === (action_uid === undefined)) {
        return errorResult("running script on device", "Provide exactly one of `script_id` or `action_uid`.");
      }

      const body: Record<string, unknown> =
        script_id !== undefined
          ? { type: "SCRIPT", id: script_id, runAs: run_as }
          : { type: "ACTION", uid: action_uid, runAs: run_as };
      if (parameters) body.parameters = parameters;

      try {
        const result = await client.post(`/device/${device_id}/script/run`, body);
        const what = script_id !== undefined ? `Script ${script_id}` : `Action ${action_uid}`;
        return textResult(
          `${what} queued for execution on device ${device_id} (run as: ${run_as}).` +
            (result ? `\n${JSON.stringify(result, null, 2)}` : "") +
            "\nUse get_device_activities or get_device_jobs to check progress.",
        );
      } catch (error) {
        return errorResult("running script on device", error);
      }
    },
  );
}
