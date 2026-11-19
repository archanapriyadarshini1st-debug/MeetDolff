import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { isOwner, json, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Revoke (soft-delete so the audit trail keeps its reference). Takes effect on the next request. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return unauthorized();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid token id." }, 400);
  const res = await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt))).returning({ id: apiTokens.id });
  return res.length ? json({ ok: true }) : json({ error: "Token not found or already revoked." }, 404);
}
