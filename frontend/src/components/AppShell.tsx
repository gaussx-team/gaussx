"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// 관리자·관제용 공통 틀: 넓은 화면은 왼쪽 메뉴, 좁은 화면은 위쪽 가로 메뉴
const NAV = [
  { href: "/", label: "대시보드", icon: "▦" },
  { href: "/control", label: "관제", icon: "◉" },
  { href: "/admin/works", label: "작업 지시", icon: "▤" },
  { href: "/admin/tags", label: "위험 태그", icon: "⚑" },
  { href: "/robot", label: "로봇", icon: "⚙" },
  { href: "/history", label: "이력", icon: "≡" },
];

interface Props {
  title: string;
  crumbs?: { href: string; label: string }[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ title, crumbs, actions, children }: Props) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 z-20 border-b border-slate-200 bg-white lg:h-dvh lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-4 py-3 lg:block lg:px-5 lg:py-5">
          <Link href="/" className="block">
            <div className="text-lg font-black tracking-tight">GaussX</div>
            <div className="hidden text-xs text-slate-500 lg:block">데모 현장 · 4×3m</div>
          </Link>
          <nav className="flex gap-1 overflow-x-auto lg:mt-6 lg:flex-col">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${active(n.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                <span className="w-4 text-center opacity-70">{n.icon}</span>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="hidden space-y-1 px-5 text-xs lg:absolute lg:bottom-5 lg:block">
          <Link href="/card" className="block text-slate-500 hover:underline">
            작업자 카드 화면 ↗
          </Link>
          <Link href="/demo" className="block text-slate-400 hover:underline">
            시연 모드
          </Link>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex flex-wrap items-end gap-3 px-4 pt-5 lg:px-8">
          <div>
            {crumbs && (
              <div className="mb-1 flex gap-1 text-xs text-slate-500">
                {crumbs.map((c) => (
                  <span key={c.href}>
                    <Link href={c.href} className="hover:underline">
                      {c.label}
                    </Link>{" "}
                    ›
                  </span>
                ))}
              </div>
            )}
            <h1 className="text-xl font-bold">{title}</h1>
          </div>
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
        <main className="p-4 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
