import { connection } from "next/server";
import { handle } from "@/lib/server/handle";
import { getInbox } from "@/lib/server/store";

// GET /api/inbox?device=device-01 — 단말이 받은 작업 목록
export async function GET(req: Request) {
  await connection();
  const device = new URL(req.url).searchParams.get("device") ?? "device-01";
  return handle(() => getInbox(device));
}
