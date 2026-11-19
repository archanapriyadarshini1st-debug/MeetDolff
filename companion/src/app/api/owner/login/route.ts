import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, owner } from "@/db/schema";
import { audit, json, passphraseMatches, startOwnerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const since = new Date(Date.now() - 15 * 60_000);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(auditLog).where(and(eq(auditLog.action, "owner-login-failed"), gte(auditLog.createdAt, since)));
  if (n >= 10) return json({ error: "Too many failed attempts. Wait 15 minutes." }, 429, { "retry-after": "900" });

  const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null;
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
  const row = (await db.select().from(owner).limit(1))[0];
  if (!row || !passphrase || !passphraseMatches(passphrase, row.salt, row.passphraseHash)) {
    await audit(null, "owner-login-failed", false);
    return json({ error: "Incorrect passphrase." }, 401);
  }
  await startOwnerSession();
  return json({ ok: true });
}
