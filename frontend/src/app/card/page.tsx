import { Suspense } from "react";
import { CardEntry } from "./CardEntry";

// useSearchParams 를 쓰는 화면은 Suspense 로 감싸야 빌드된다 (Next 16)
export default function CardPage() {
  return (
    <Suspense fallback={<p className="p-6 text-center text-slate-500">불러오는 중…</p>}>
      <CardEntry />
    </Suspense>
  );
}
