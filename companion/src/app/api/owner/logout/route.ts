import { endOwnerSession, json } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  await endOwnerSession();
  return json({ ok: true });
}
