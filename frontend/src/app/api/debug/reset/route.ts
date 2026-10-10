import { handle } from "@/lib/server/handle";
import { reset } from "@/lib/server/store";

export async function POST() {
  return handle(() => {
    reset();
    return { ok: true };
  });
}
