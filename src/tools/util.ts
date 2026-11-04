import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data ?? null, null, 2));
}

export function errorResult(context: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error ${context}: ${message}` }],
    isError: true,
  };
}

/**
 * Wraps a tool handler so any thrown error becomes an MCP error result
 * instead of a protocol-level failure.
 */
export function safe<A>(
  context: string,
  handler: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(context, error);
    }
  };
}
