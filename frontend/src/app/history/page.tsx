import { Suspense } from "react";
import { HistoryView } from "./HistoryView";

export default function HistoryPage() {
  return (
    <Suspense fallback={<p className="p-8 text-slate-500">불러오는 중…</p>}>
      <HistoryView />
    </Suspense>
  );
}
