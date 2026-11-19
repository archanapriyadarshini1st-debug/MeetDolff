import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, count, eq, gt, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, auditLog, owner, ownerSessions } from "@/db/schema";

export const SCOPES = ["memory:read", "memory:sync"] as const;
export type Scope = (typeof SCOPES)[number];

const SESSION_COOKIE = "md_owner";
const SESSION_DAYS = 7;

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function hashPassphrase(passphrase: string, salt: string): string {
  return scryptSync(passphrase, salt, 64).toString("hex");
}

export function passphraseMatches(passphrase: string, salt: string, expectedHex: string): boolean {
  const a = Buffer.from(hashPassphrase(passphrase, salt), "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newApiToken(): { token: string; prefix: string } {
  const token = `mdk_${randomBytes(24).toString("base64url")}`;
  return { token, prefix: token.slice(0, 8) };
}

export async function ownerExists(): Promise<boolean> {
  const rows = await db.select({ id: owner.id }).from(owner).limit(1);
  return rows.length > 0;
}

export async function startOwnerSession(): Promise<void> {
  const value = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(ownerSessions).values({ tokenHash: sha256(value), expiresAt });
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" && process.env.COMPANION_INSECURE_COOKIES !== "1",
    path: "/",
    expires: expiresAt,
  });
}

export async function endOwnerSession(): Promise<void> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  if (value) await db.delete(ownerSessions).where(eq(ownerSessions.tokenHash, sha256(value)));
  jar.delete(SESSION_COOKIE);
}

export async function isOwner(): Promise<boolean> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return false;
  const rows = await db
    .select({ h: ownerSessions.tokenHash })
    .from(ownerSessions)
    .where(and(eq(ownerSessions.tokenHash, sha256(value)), gt(ownerSessions.expiresAt, new Date())))
    .limit(1);
  return rows.length > 0;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export const unauthorized = () => json({ error: "Owner sign-in required." }, 401);

export async function audit(tokenId: string | null, action: string, ok: boolean, detail?: string): Promise<void> {
  await db.insert(auditLog).values({ tokenId, action, ok, detail: detail?.slice(0, 300) ?? null });
}

export type TokenAuth = { ok: true; tokenId: string } | { ok: false; response: Response };

/** Bearer-token auth with scope check and a per-token rate limit. Never reveals why a token failed. */
export async function authenticateToken(req: Request, scope: Scope): Promise<TokenAuth> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(mdk_[\w-]{20,})$/.exec(header);
  const deny = (status: number, error: string): TokenAuth => ({ ok: false, response: json({ error }, status, status === 401 ? { "www-authenticate": 'Bearer realm="meetdolff"' } : {}) });
  if (!match) return deny(401, "Missing or malformed bearer token.");

  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, sha256(match[1]!)), isNull(apiTokens.revokedAt)))
    .limit(1);
  const token = rows[0];
  if (!token) return deny(401, "Invalid or revoked token.");
  if (!token.scopes.includes(scope)) {
    await audit(token.id, `denied:${scope}`, false, "scope missing");
    return deny(403, `This token does not have the ${scope} scope.`);
  }

  const since = new Date(Date.now() - 60_000);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.tokenId, token.id), gte(auditLog.createdAt, since)));
  if (n >= token.rateLimitPerMin) {
    return { ok: false, response: json({ error: "Rate limit exceeded. Try again shortly." }, 429, { "retry-after": "30" }) };
  }
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id));
  return { ok: true, tokenId: token.id };
}
