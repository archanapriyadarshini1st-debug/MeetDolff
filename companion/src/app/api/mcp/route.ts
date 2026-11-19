import { audit, authenticateToken, json } from "@/lib/auth";
import { PROTOCOL_VERSION, SERVER_INFO, TOOLS, callTool } from "@/lib/mcp";
import { ValidationError } from "@/lib/memory";

export const dynamic = "force-dynamic";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, tokenId: string): Promise<unknown | null> {
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: "Read-only access to the user's MeetDolff meeting memory. Cite meeting titles and timestamps. If a search returns nothing, say the memory has no answer." });
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args);
        await audit(tokenId, `tool:${name}`, true);
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        const message = e instanceof ValidationError ? e.message : "Tool failed.";
        await audit(tokenId, `tool:${name}`, false, message);
        // Tool-level failures are results with isError, not protocol errors, so the model can recover.
        return ok(msg.id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return isNotification ? null : err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const auth = await authenticateToken(req, "memory:read");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => undefined)) as Rpc | Rpc[] | undefined;
  if (!body || typeof body !== "object") return json(err(null, -32700, "Parse error"), 400);
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return json(err(null, -32600, "Batch must contain 1–20 requests."), 400);
    const out = (await Promise.all(body.map((m) => handle(m, auth.tokenId)))).filter((r) => r !== null);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const res = await handle(body, auth.tokenId);
  return res === null ? new Response(null, { status: 202 }) : json(res);
}

/** Streamable HTTP servers may offer SSE on GET; this one is request/response only. */
export async function GET() {
  return new Response("This MCP endpoint accepts POST JSON-RPC only.", { status: 405, headers: { allow: "POST" } });
}
