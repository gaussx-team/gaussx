import { Suspense } from "react";
import { DrawingPage } from "./DrawingPage";

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-center text-slate-500">불러오는 중…</p>}>
      <DrawingPage />
    </Suspense>
  );
}
