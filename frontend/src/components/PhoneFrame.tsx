// 웹에서 작업자 휴대폰 화면을 보여주는 틀
export function PhoneFrame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative mx-auto w-[360px] max-w-full rounded-[44px] border-[10px] border-slate-900 bg-slate-900 shadow-xl ${className}`}>
      <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-slate-900" />
      <div className="h-[720px] max-h-[80dvh] overflow-hidden rounded-[34px] bg-slate-50">{children}</div>
    </div>
  );
}
