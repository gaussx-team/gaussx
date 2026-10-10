import { handle } from "@/lib/server/handle";
import { acknowledge } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return acknowledge(Number(b.alertId));
  });
}
