import { ApiError } from "./store";

// 목업 API 공통 처리: 오류는 400 + 한국어 메시지 (백엔드 예외 필터와 같은 모양)
export async function handle(fn: () => unknown | Promise<unknown>) {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ message: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ message: "서버 오류가 났어요" }, { status: 500 });
  }
}
