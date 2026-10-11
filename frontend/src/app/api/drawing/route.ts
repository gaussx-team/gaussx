import { handle } from "@/lib/server/handle";
import { createDrawing } from "@/lib/server/store";

// POST /api/drawing — { title, kind, dwgNo, revision, zoneIds, equipment, fileName, mime, dataBase64 }
export async function POST(req: Request) {
  return handle(async () => createDrawing(await req.json()));
}
