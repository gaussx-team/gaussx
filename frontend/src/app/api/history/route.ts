import { connection } from "next/server";
import { handle } from "@/lib/server/handle";
import { getHistory } from "@/lib/server/store";
import type { EventCategory } from "@/lib/types";

// GET /api/history?day=2026-10-11|today|all&cat=work,alert&zone=Z1&work=3&q=P-203
export async function GET(req: Request) {
  await connection();
  const sp = new URL(req.url).searchParams;
  const cat = sp.get("cat");
  const work = sp.get("work");
  return handle(() =>
    getHistory({
      day: sp.get("day"),
      categories: cat ? (cat.split(",") as EventCategory[]) : [],
      zoneId: sp.get("zone"),
      workId: work ? Number(work) : null,
      q: sp.get("q"),
    }),
  );
}
