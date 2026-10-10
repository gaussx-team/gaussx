import { Suspense } from "react";
import { WorkDetail } from "./WorkDetail";

export default function WorkDetailPage() {
  return (
    <Suspense fallback={<p className="p-8 text-slate-500">불러오는 중…</p>}>
      <WorkDetail />
    </Suspense>
  );
}
