import { connection } from "next/server";
import { ApiError, getDrawingFile } from "@/lib/server/store";

// GET /api/drawing/file?id=5 — 업로드한 도면 파일 (CAD 원본은 내려받기)
export async function GET(req: Request) {
  await connection();
  try {
    const f = getDrawingFile(Number(new URL(req.url).searchParams.get("id")));
    const cad = /\.(dwg|dxf|dgn)$/i.test(f.fileName);
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `${cad ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      },
    });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return Response.json({ message: e instanceof Error ? e.message : "오류" }, { status });
  }
}
