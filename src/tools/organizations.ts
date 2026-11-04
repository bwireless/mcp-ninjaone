import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NinjaOneClient } from "../ninjaone-client.js";
import { errorResult, jsonResult } from "./util.js";

const organizationId = z.number().int().positive().describe("NinjaOne organization ID");
const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

interface OrgPolicyAssignment {
  nodeRoleId?: number;
  policyId?: number;
}

interface Policy {
  id: number;
  name?: string;
  nodeClass?: string;
}

export function registerOrganizationTools(server: McpServer, client: NinjaOneClient) {
  server.registerTool(
    "list_organizations",
    {
      title: "List organizations",
      description:
        "List organizations (clients/customers) in NinjaOne with their ID, name, and description. Paginate by passing the last organization ID returned as `after`.",
      inputSchema: {
        page_size: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(100)
          .describe("Number of organizations to return"),
        after: z
          .number()
          .int()
          .optional()
          .describe("Return organizations with an ID greater than this (pagination cursor)"),
        filter: z
          .string()
          .optional()
          .describe("Organization filter (of) expression"),
      },
      annotations: READ_ONLY,
    },
    async ({ page_size, after, filter }) => {
      try {
        return jsonResult(
          await client.get("/organizations", { pageSize: page_size, after, of: filter }),
        );
      } catch (error) {
        return errorResult("listing organizations", error);
      }
    },
  );

  server.registerTool(
    "get_organization",
    {
      title: "Get organization",
      description:
        "Get detailed information about an organization, including locations, node approval mode, policy assignments, and settings.",
      inputSchema: { organization_id: organizationId },
      annotations: READ_ONLY,
    },
    async ({ organization_id }) => {
      try {
        return jsonResult(await client.get(`/organization/${organization_id}`));
      } catch (error) {
        return errorResult("fetching organization", error);
      }
    },
  );

  server.registerTool(
    "list_organization_devices",
    {
      title: "List organization devices",
      description: "List devices belonging to a specific organization.",
      inputSchema: {
        organization_id: organizationId,
        page_size: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(100)
          .describe("Number of devices to return"),
        after: z
          .number()
          .int()
          .optional()
          .describe("Return devices with an ID greater than this (pagination cursor)"),
      },
      annotations: READ_ONLY,
    },
    async ({ organization_id, page_size, after }) => {
      try {
        return jsonResult(
          await client.get(`/organization/${organization_id}/devices`, {
            pageSize: page_size,
            after,
          }),
        );
      } catch (error) {
        return errorResult("listing organization devices", error);
      }
    },
  );

  server.registerTool(
    "get_organization_locations",
    {
      title: "Get organization locations",
      description: "Get the locations configured for an organization.",
      inputSchema: { organization_id: organizationId },
      annotations: READ_ONLY,
    },
    async ({ organization_id }) => {
      try {
        return jsonResult(await client.get(`/organization/${organization_id}/locations`));
      } catch (error) {
        return errorResult("fetching organization locations", error);
      }
    },
  );

  server.registerTool(
    "get_organization_policies",
    {
      title: "Get organization policies",
      description:
        "Get the policy assignments for an organization (which policy applies to each device role), with policy names resolved.",
      inputSchema: { organization_id: organizationId },
      annotations: READ_ONLY,
    },
    async ({ organization_id }) => {
      try {
        const org = (await client.get(`/organization/${organization_id}`)) as {
          id?: number;
          name?: string;
          policies?: OrgPolicyAssignment[];
        };
        const assignments = org?.policies ?? [];

        // Best effort: resolve policy names. Ignore failures (e.g. missing scope).
        let byId = new Map<number, Policy>();
        try {
          const policies = (await client.get("/policies")) as Policy[];
          byId = new Map(policies.map((p) => [p.id, p]));
        } catch {
          /* names are optional */
        }

        return jsonResult({
          organizationId: org?.id ?? organization_id,
          organizationName: org?.name,
          policies: assignments.map((a) => ({
            ...a,
            policyName: a.policyId !== undefined ? byId.get(a.policyId)?.name : undefined,
            nodeClass: a.policyId !== undefined ? byId.get(a.policyId)?.nodeClass : undefined,
          })),
        });
      } catch (error) {
        return errorResult("fetching organization policies", error);
      }
    },
  );

  server.registerTool(
    "list_policies",
    {
      title: "List policies",
      description:
        "List all policies defined in NinjaOne (ID, name, description, node class, parent policy). Alert conditions are configured within policies.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        return jsonResult(await client.get("/policies"));
      } catch (error) {
        return errorResult("listing policies", error);
      }
    },
  );
}
