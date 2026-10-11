import { handle } from "@/lib/server/handle";
import { verifyTag } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return verifyTag(Number(b.tagId));
  });
}
