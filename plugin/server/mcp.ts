// Minimal stdio MCP: the slice a channel needs, without the 91-package SDK.
export type Json = Record<string, unknown>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run(args: Json): Promise<string>;
}

export interface ServerOpts {
  name: string;
  version: string;
  instructions: string;
  tools: Tool[];
  onNotification(method: string, params: Json): Promise<void>;
}

/** Claude Code doesn't register channels that negotiate this revision. */
const UNREGISTERED = "2026-07-28";
const FALLBACK = "2025-06-18";

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

export function createServer(opts: ServerOpts, write: (line: string) => void) {
  const send = (msg: Json) => write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  const notify = (method: string, params: Json) => send({ method, params });

  async function dispatch(method: string, params: Json): Promise<Json> {
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return {
          protocolVersion: typeof asked === "string" && asked !== UNREGISTERED ? asked : FALLBACK,
          capabilities: {
            experimental: { "claude/channel": {}, "claude/channel/permission": {} },
            tools: {},
          },
          serverInfo: { name: opts.name, version: opts.version },
          instructions: opts.instructions,
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: opts.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
      case "tools/call":
        return callTool(params);
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  async function callTool(params: Json): Promise<Json> {
    const tool = opts.tools.find((t) => t.name === params.name);
    if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(params.name)}`);
    try {
      const text = await tool.run((params.arguments ?? {}) as Json);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  }

  async function handle(line: string): Promise<void> {
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: "Parse error" } });
    }
    const { id, method } = msg;
    const params = (msg.params ?? {}) as Json;
    if (typeof method !== "string") return; // a response; we never send requests
    if (id === undefined) {
      await opts.onNotification(method, params).catch((e) => console.error(`away-mode: ${e.message}`));
      return;
    }
    try {
      send({ id, result: await dispatch(method, params) });
    } catch (e) {
      const code = e instanceof RpcError ? e.code : -32603;
      send({ id, error: { code, message: (e as Error).message } });
    }
  }

  return { handle, notify };
}
