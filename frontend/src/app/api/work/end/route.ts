import { handle } from "@/lib/server/handle";
import { endWork } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return endWork(Number(b.workId));
  });
}
