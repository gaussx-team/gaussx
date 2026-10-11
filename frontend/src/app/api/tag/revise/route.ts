import { handle } from "@/lib/server/handle";
import { reviseTag } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return reviseTag(Number(b.tagId), b.patch ?? {});
  });
}
