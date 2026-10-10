import { connection } from "next/server";
import { handle } from "@/lib/server/handle";
import { getWorkDetail } from "@/lib/server/store";

// GET /api/work/3 — 작업 지시 상세 (확인 결과·알림·이력 포함)
export async function GET(_req: Request, ctx: RouteContext<"/api/work/[id]">) {
  await connection();
  const { id } = await ctx.params;
  return handle(() => getWorkDetail(Number(id)));
}
