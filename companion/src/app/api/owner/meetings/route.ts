import { deleteMeetingRow, listMeetingSummaries } from "@/lib/memory";
import { isOwner, json, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isOwner())) return unauthorized();
  return json({ meetings: await listMeetingSummaries() });
}

export async function DELETE(req: Request) {
  if (!(await isOwner())) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return json({ error: "Missing id." }, 400);
  await deleteMeetingRow(id);
  return json({ ok: true });
}
