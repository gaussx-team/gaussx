import { handle } from "@/lib/server/handle";
import { confirm } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return confirm({ workId: Number(b.workId), checkItemId: Number(b.checkItemId), value: b.value ?? null, photo: b.photo ?? null });
  });
}
