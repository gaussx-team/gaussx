import { handle } from "@/lib/server/handle";
import { resolve } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return resolve(Number(b.alertId), b.resolution === "false_alarm" ? "false_alarm" : "handled");
  });
}
