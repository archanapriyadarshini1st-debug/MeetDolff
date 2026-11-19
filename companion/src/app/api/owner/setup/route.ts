import { db } from "@/db";
import { owner } from "@/db/schema";
import { hashPassphrase, json, ownerExists, startOwnerSession } from "@/lib/auth";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

/** First-run claim. Succeeds exactly once; afterwards the owner row exists and this returns 409. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null;
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
  if (passphrase.length < 12) return json({ error: "Use a passphrase of at least 12 characters." }, 400);
  if (await ownerExists()) return json({ error: "This companion already has an owner." }, 409);
  const salt = randomBytes(16).toString("hex");
  try {
    await db.insert(owner).values({ id: 1, passphraseHash: hashPassphrase(passphrase, salt), salt });
  } catch {
    return json({ error: "This companion already has an owner." }, 409); // lost a race with another claim
  }
  await startOwnerSession();
  return json({ ok: true });
}
