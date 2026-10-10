import { handle } from "@/lib/server/handle";
import { openCard } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return openCard(Number(b.workId));
  });
}
