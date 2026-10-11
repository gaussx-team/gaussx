import { handle } from "@/lib/server/handle";
import { cancelWork } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return cancelWork(Number(b.workId), String(b.reason ?? ""));
  });
}
