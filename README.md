# GaussX

3D 공간 위 위험 정보 태그 → 작업반장 카드 전달·확인 → 쓰러짐 감지 → 로봇(시뮬) 출동까지 잇는 산업 현장 안전 데모.

| 폴더 | 내용 | 담당 |
|---|---|---|
| `frontend/` | Next.js 웹 (담당자 · 작업반장 카드 · 관제) | 문정 |
| `backend/` | NestJS + PostgreSQL | 현령 |
| `3dgs/` | 3DGS 처리 코드 (결과 파일은 커밋하지 않음) | 건우 |
| `docs/` | 기준 문서(SPEC) · API 약속 · ERD | 공통 |

- 규칙: [CONVENTION.md](CONVENTION.md)
- 기준 문서: [docs/SPEC.md](docs/SPEC.md) · API: [docs/api.md](docs/api.md) · 데이터: [docs/ERD.md](docs/ERD.md)
- 와이어프레임: [Figma](https://www.figma.com/design/hbD7GS4spj5wOAZPnigBt9)

## 실행 (데모 노트북)

> 각 파트 세팅 후 채운다 (10/12: DB · backend)

```bash
# 1. DB — 개발은 설치 없이 PGlite(자동, PostgreSQL 17.5). 무대 노트북은 PostgreSQL 17 → backend/.env 의 DATABASE_URL
# 2. backend (3001) — 처음 켜면 데모 데이터가 든 회차를 만든다. API 문서 http://localhost:3001/docs
cd backend && npm install && npm run dev
# 3. frontend (3000) — frontend/.env.local 에 NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 (비우면 Next 목업)
cd frontend && npm install && npm run dev
```

## 일정

| 날짜 | |
|---|---|
| 10/14 (수) | 중간 점검 |
| 11/4 (화) 13:00 | 제출 마감 |
| 11/5~6 | 데모데이 |
