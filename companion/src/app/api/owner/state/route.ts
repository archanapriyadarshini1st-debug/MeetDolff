import { json, isOwner, ownerExists } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = await ownerExists();
  return json({ configured, authenticated: configured ? await isOwner() : false });
}
