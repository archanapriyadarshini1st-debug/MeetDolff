import { desc } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { SCOPES, isOwner, json, newApiToken, sha256, unauthorized, type Scope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isOwner())) return unauthorized();
  const rows = await db.select({
    id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, scopes: apiTokens.scopes,
    rateLimitPerMin: apiTokens.rateLimitPerMin, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt,
  }).from(apiTokens).orderBy(desc(apiTokens.createdAt));
  return json({ tokens: rows });
}

/** Creates a token. Scopes default to read-only; the plaintext is returned once and cannot be recovered. */
export async function POST(req: Request) {
  if (!(await isOwner())) return unauthorized();
  const body = (await req.json().catch(() => null)) as { name?: unknown; scopes?: unknown; rateLimitPerMin?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return json({ error: "Give the token a name so you can recognise it later." }, 400);
  const requested = Array.isArray(body?.scopes) ? body.scopes : ["memory:read"];
  const scopes = requested.filter((s): s is Scope => (SCOPES as readonly string[]).includes(String(s)));
  if (scopes.length === 0 || scopes.length !== requested.length) return json({ error: `Scopes must be from: ${SCOPES.join(", ")}.` }, 400);
  const rate = Math.min(Math.max(Math.round(Number(body?.rateLimitPerMin) || 60), 1), 600);
  const { token, prefix } = newApiToken();
  const [row] = await db.insert(apiTokens).values({ name, tokenHash: sha256(token), prefix, scopes, rateLimitPerMin: rate }).returning({ id: apiTokens.id });
  return json({ id: row?.id, token, prefix, scopes, note: "Copy this token now. It is stored only as a hash and cannot be shown again." }, 201);
}
