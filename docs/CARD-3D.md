# 작업 카드 3D

MCC-3 배전반 점검 카드에서 배정된 설비의 공간과 주변 공정 위험을 확인한다. 장면은 **생성형 AI로 만든 시연용 가상 공장**이다.

## 장면 파일 받기

장면 파일은 GitHub Release 첨부 또는 공유 드라이브의 **직접 다운로드 URL**로 별도 전달한다. 배포 주소는 결정 후 `frontend/scripts/scene-source.json`의 `url`에 넣는다. 프론트엔드 폴더에서 `npm run scene:fetch` 한 번으로 `public/scenes/a-v2d.spz`를 준비한다. URL 결정 전에는 다음과 같이 직접 지정할 수 있다.

```bash
cd frontend
npm ci
npm run scene:fetch -- --url <직접-다운로드-URL>
npm run dev -- --port 3100
```

`scene-source.json`의 `sha256`은 선택값이다. 알려진 해시가 있으면 설정하거나 `--sha256 <해시>`를 붙인다. 스크립트는 리다이렉트를 따르고 파일 형식·Gaussian 수·SH 차수와 지정된 해시를 검사한 뒤 교체한다. 공유 드라이브의 로그인/HTML 공유 페이지는 다운로드 주소로 사용할 수 없다. 같은 파일이면 다시 쓰지 않고, 실패하면 기존 정상 파일을 보존한다. Windows에서 실행 중인 서버가 다른 장면 파일의 교체를 막으면 서버를 멈춘 뒤 명령을 다시 실행한다.

현재 A구역 v2d 파일은 SPZ3, SH3, Gaussian 998,276개, 21,924,807 bytes이다. SHA256은 `fce9ce44210f0f680eb124a40b0f775817b5bafefae9295cbfe01a5604820b7d`이다. 장면 파일·원본 사진·렌더는 공개 저장소에 올리지 않는다.

## 로컬 또는 원격 장면 주소

`NEXT_PUBLIC_GAUSSX_SCENE_URL` 하나로 장면 위치를 지정한다. 비우면 `public/scenes/card-active.json`의 `model.url`을 사용한다. 현재 기본값 `/scenes/a-v2d.spz`는 `frontend/public/scenes/a-v2d.spz`에 대응한다.

- 로컬 파일: `/scenes/a-v2d.spz`
- 원격 파일: `https://배포서버/장면.spz` 같은 HTTP(S) 직접 다운로드 URL

환경변수는 `frontend/.env.local`에 설정하고 개발 서버를 다시 시작한다. 운영 빌드에서는 `npm run build` 전에 설정해야 한다. 이 값은 브라우저에 공개되므로 비밀 토큰을 넣지 않는다. 원격 서버는 앱 출처의 CORS 요청을 허용해야 한다. 데모장에서는 파일을 미리 받아 기본 로컬 경로로 실행한다.

장면 파일이 없어도 카드의 기존 확인 항목은 사용할 수 있다. 3D 영역에만 **3D 장면 파일 없음 — 받는 방법: docs 안내**가 나온다. 앱 안의 안내 주소는 `/card/space/help`이다. 파일을 준비한 뒤 ‘다시 열기’를 누르면 된다.

## 실행과 캡처 시점

`NEXT_PUBLIC_API_BASE_URL`을 비우면 기존 Next 목업을 쓴다. 기존 백엔드를 쓰려면 기존과 같이 이 값을 백엔드 주소로 지정한다. 3D 모듈은 같은 API 설정을 따른다.

| 용도 | URL |
|---|---|
| 휴대폰 틀의 실제 카드 | `/card?work=8` |
| 기록을 남기지 않는 카드 미리보기 | `/card?work=8&preview=1` |
| 넓은 캡처 화면, 배정 위치 | `/card/space?work=8&view3d=work` |
| 넓은 캡처 화면, 주변 위험 전체 | `/card/space?work=8&view3d=nearby` |
| 불산 배관 | `/card/space?work=8&view3d=P-203` |
| 황산 펌프 | `/card/space?work=8&view3d=PU-07` |
| 황산 탱크 | `/card/space?work=8&view3d=T-02` |

예: `http://localhost:3100/card/space?work=8&view3d=nearby`. `view3d`는 카드 미리보기에도 붙일 수 있다. `/card/space`는 GET만 사용하며 열람·확인 기록을 쓰지 않는다. 실제 `/card?work=8`은 기존 카드 흐름대로 열람 기록을 남긴다. 덱 최종 캡처는 master가 진행한다.

`work`는 원본의 검증된 MCC-3 시점이다. `nearby`는 설비 네 곳이 선명하게 보이도록 카드용으로 시각 검토한 내부 시점이며, 원본 PSNR/SSIM 평가 점수는 없다. 원본 `upper_overview` 등 다른 프리셋은 보존했다.

드래그로 회전하고 휠 또는 두 손가락으로 확대한다. ‘내 위치로 돌아가기’는 검증된 배정 시점으로 정확히 복원한다. 태그 글상자는 서로 겹치지 않게 배치하고, 가용 공간에 들어가지 않으면 주변 목록으로 확인한다. 화면 밖 설비는 주변 목록에 남는다.

## 장면 교체

브라우저가 읽는 **설정은 `frontend/public/scenes/card-active.json` 하나**이다. 전체동 장면을 받으면 모델 파일과 이 설정을 함께 교체한다. 컴포넌트나 백엔드를 고칠 필요는 없다.

1. 새 모델을 `public/scenes/`에 준비하고 `model.url`, `format`, `count`, `shDegree`를 맞춘다. 다운로드 도구는 SPZ를 검증한다. 런타임은 Spark가 지원하는 형식을 파일 확장자로 판별한다.
2. `anchors`에 설비 ID, 이름, 미터 단위 `[x,y,z]`를 넣고, `presets`에 같은 좌표계의 OpenGL camera-to-world 4×4 행 배열을 넣는다. 현재 런타임 좌표는 **Z-up 미터, 모델 변환 identity**이다. 다른 좌표계의 자료는 준비 단계에서 이 기준으로 맞춘다.
3. `work`, `nearby` 프리셋, 설비 ID별 프리셋, `defaultWorkEquipment`, `contextEquipment`, `background`, `horizontalFovDegrees`, `nearbyRadiusMeters`를 맞춘다. `id`도 새 장면 값으로 바꾼다.
4. `scene-source.json`에 새 URL과 선택 해시를 넣는다. 원격 URL 환경변수를 쓰고 있다면 새 모델에 맞춰 바꾸거나 비운다. 앱을 새로 열고 배정 시점·주변 시점과 거리 표시를 확인한다.

기존 형제 폴더 `virtual-site`가 있는 개발 환경에서는 `npm run scene:prepare`로 A v2d 원본을 CPU에서 압축할 수 있다. 새 패키지를 설치하지 않고 설치된 Spark의 공식 `transcodeSpz`를 사용한다. 동일 입력의 재실행은 파일을 다시 쓰지 않는다. 이 명령은 **A v2d 준비 전용**이므로 전체동 설정 교체 뒤에는 실행하지 않는다.

## 데이터와 거리의 의미

작업 제목 또는 작업에 묶인 유일한 설비 태그의 ID를 장면 앵커와 연결한다. 위치를 알 수 없는 작업에는 임의의 MCC-3 위치를 표시하지 않는다. 내 작업 태그는 보낸 순간의 카드 버전을, 주변 공정 태그는 `/api/tags`에서 받은 현재 active 버전을 표시한다. 주변 정보는 10초마다 갱신하며 미검증 태그는 주황색으로 구분한다.

기존 `Tag.x/y`는 평면도·도면·로봇의 별도 바닥 좌표이므로 덮어쓰지 않았다. 3D 위치는 장면 설정의 `설비 ID → [x,y,z]` 매핑에 있다. 기존 작업의 `tagIds`, 확인 항목, API·DB 스키마, 백엔드 seed는 변경하지 않았다.

MCC-3 앵커에서 PU-07 3.2m, P-203 6.1m, T-02 7.2m이다. 표시는 **설비 앵커 간 3차원 직선거리**이며 보행거리·사람의 실시간 위치·위험 영향반경이 아니다. `nearbyRadiusMeters: 8`은 이번 시연에서 주변 태그를 고르는 표시 범위다. 앵커는 설비 메타데이터의 기준점이므로 표면과 일치하지 않을 수 있고, 가림을 판정하지 않아 가려진 설비도 태그로 보인다.

## 확인

```bash
cd frontend
npm run lint
npm run test:card3d
npm run build
```

테스트 실행에는 Node.js 22.18 이상(내장 TypeScript stripping)이 필요하다. 실제 브라우저에서는 WebGL2가 필요하다. GPU를 지원하지 않거나 장면이 손상된 경우 3D 영역에 다시 열기·안내 링크를 표시한다.
