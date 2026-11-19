import { audit, authenticateToken, isOwner, json } from "@/lib/auth";
import { ValidationError, parseMeeting, upsertMeetings } from "@/lib/memory";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_MEETINGS = 200;

/**
 * Import exported meeting memory (`meetings/*.json`). Accepts the signed-in owner
 * or a token holding the memory:sync scope. Body: { meetings: Meeting[] }.
 */
export async function POST(req: Request) {
  let tokenId: string | null = null;
  if (!(await isOwner())) {
    const auth = await authenticateToken(req, "memory:sync");
    if (!auth.ok) return auth.response;
    tokenId = auth.tokenId;
  }
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return json({ error: "Payload too large (20 MB max)." }, 413);
  const body = (await req.json().catch(() => null)) as { meetings?: unknown } | null;
  if (!body || !Array.isArray(body.meetings) || body.meetings.length === 0) return json({ error: "Body must be { meetings: [...] } with at least one meeting." }, 400);
  if (body.meetings.length > MAX_MEETINGS) return json({ error: `At most ${MAX_MEETINGS} meetings per request.` }, 413);
  try {
    const parsed = body.meetings.map(parseMeeting);
    const saved = await upsertMeetings(parsed);
    await audit(tokenId, "sync", true, `${saved} meeting(s)`);
    return json({ ok: true, saved });
  } catch (e) {
    if (e instanceof ValidationError) {
      await audit(tokenId, "sync", false, e.message);
      return json({ error: e.message }, 422);
    }
    throw e;
  }
}
