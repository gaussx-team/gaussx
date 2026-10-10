import { WORK_STATUS_LABEL } from "@/lib/format";
import type { WorkStatus } from "@/lib/types";

const STYLE: Record<WorkStatus, string> = {
  published: "bg-amber-50 text-amber-700 ring-amber-200",
  opened: "bg-sky-50 text-sky-700 ring-sky-200",
  confirmed: "bg-blue-600 text-white ring-blue-600",
  ended: "bg-slate-100 text-slate-500 ring-slate-200",
};

export function StatusBadge({ status }: { status: WorkStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${STYLE[status]}`}>{WORK_STATUS_LABEL[status]}</span>;
}
