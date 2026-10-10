import { handle } from "@/lib/server/handle";
import { raiseFall } from "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    return raiseFall({ source: b.source ?? "debug", deviceId: b.deviceId ?? null, zoneId: b.zoneId ?? null });
  });
}
