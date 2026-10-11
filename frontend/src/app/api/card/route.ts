import { connection } from "next/server";
import { handle } from "@/lib/server/handle";
import { getCard } from "@/lib/server/store";

// GET /api/card?device=device-01  (작업자 휴대폰)
// GET /api/card?work=3            (관리자 미리보기) — 카드 주소 방식은 현령님과 확정 전, docs/api.md
export async function GET(req: Request) {
  await connection();
  const sp = new URL(req.url).searchParams;
  const work = sp.get("work");
  return handle(() => getCard({ deviceId: sp.get("device") ?? "device-01", workId: work ? Number(work) : null }));
}
