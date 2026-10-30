import { Suspense } from "react";
import { SpaceCapture } from "./SpaceCapture";

export default function CardSpacePage() {
  return <Suspense fallback={<p className="p-8 text-sm text-slate-500">작업 공간을 여는 중…</p>}><SpaceCapture /></Suspense>;
}
