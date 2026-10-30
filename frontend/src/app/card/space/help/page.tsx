import Link from "next/link";

export default function CardSceneHelp() {
  return <main className="mx-auto max-w-xl space-y-5 p-6 py-12 text-sm leading-7 text-slate-600">
    <p className="text-xs font-bold text-blue-700">GaussX · 3D 장면 안내</p>
    <h1 className="text-2xl font-bold text-slate-900">3D 장면 파일 받는 방법</h1>
    <p>시연용 공장 파일은 코드 저장소와 별도로 전달합니다. 팀에 공유된 장면 다운로드 주소를 받은 뒤, 프론트엔드 폴더에서 아래 명령을 한 번 실행하세요.</p>
    <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-white">npm run scene:fetch -- --url &lt;다운로드 주소&gt;</pre>
    <p>파일은 <code>public/scenes/</code>에 준비됩니다. 이미 파일을 받았다면 카드를 새로 열거나 3D 영역의 ‘다시 열기’를 누르세요. 장면 주소를 직접 연결하려면 <code>NEXT_PUBLIC_GAUSSX_SCENE_URL</code>을 지정합니다.</p>
    <p>개발·장면 교체·배포 설정은 저장소의 <code>docs/CARD-3D.md</code>에 있습니다. 파일을 받기 전에도 작업 카드의 확인 항목은 사용할 수 있어요.</p>
    <Link href="/card" className="inline-block font-semibold text-blue-700 underline">내 작업으로 돌아가기 →</Link>
  </main>;
}
