# S.E.E.D. Internal Terminal

카미가카리 RPG 「Case Number Six」 — 기관 정보 관리 앱 (Supabase 연동)

## 기능

### 사이드바 5개 섹션
- **기관 소개** (About) — 카드 그리드 + 편집 페이지
- **사건 일람** (Cases) — 테이블 리스트
- **대상 보고서** (Dossier) — 심화·후속 보고서
- **요원 명부** (Agents) — 소속별 그룹 + 상세 페이지
- **작전 일지** (Logs) — 일자별 리스트

### 블록 에디터 (모든 상세 페이지 공통)
- 큰 제목 / 중간 제목 / 본문 / 구분선 / 이미지
- 블록별 ↑ ↓ ✕ / 구분선 스타일 토글
- 텍스트 서식 툴바 (폰트 / 크기 / 볼드 / 이탤릭 / 취소선 / 정렬)

### 로그인 시스템
- 각 요원에게 로그인 계정 설정 가능
- 3.5초 터미널 연출 (권한 요청 → 신원 확인 → 접근 허용)
- 최초 접속 시 자동으로 첫 관리 요원 생성
- 우측 사이드바에 현재 로그인 요원 표시

### Supabase 클라우드 동기화
- 모든 데이터는 Supabase 원격 DB에 저장 → 다기기 동기화
- 이미지/사진은 Supabase Storage에 업로드
- 800ms 디바운스 자동 저장
- 상단 우측 동기화 상태 표시

## 파일 구조
```
index.html            — HTML 셸
style.css             — 디자인 토큰, 전체 스타일
config.js             — Supabase URL / anon key
app.js                — 라우터, 저장소, 에디터, 로그인
supabase-schema.sql   — DB 스키마 (한 번만 실행)
```

## 설치

### 1. Supabase 프로젝트 설정 (이미 완료)
- SQL Editor에서 `supabase-schema.sql` 실행
- Storage에 3개 Public 버킷 생성: `photos`, `images`, `audio`

### 2. GitHub Pages 배포
- 저장소에 5개 파일 업로드
- Settings → Pages → Source: main branch → Save

## 보안 참고
- anon key는 클라이언트에 노출됨 (공개되어도 정책상 안전)
- 현재 RLS 정책은 anon 키로 전체 읽기/쓰기 허용 (개인 프로젝트 기준)
- 정말 보안이 필요하면 Supabase Auth 도입 필요
