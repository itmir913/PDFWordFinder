# 🔍 학교생활기록부 일괄 점검 프로그램

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-orange)](https://polyformproject.org/licenses/noncommercial/1.0.0) [![GitHub Release](https://img.shields.io/github/v/tag/itmir913/WordFinderApp?label=latest&color=blue)](https://github.com/itmir913/WordFinderApp/tags)

본 프로그램은 교사가 학교생활기록부를 효율적으로 점검할 수 있도록 돕는 도구입니다. **PDF와 Excel(.xlsx)** 파일을 지원하며, 발견된 단어를 자동으로 강조하고 북마크를 생성합니다.

---

## 🚀 사용자 가이드 (선생님용)

### 📌 Step 1. 검색 기준 설정
* 검색할 단어들이 나열된 **CSV 파일**을 준비합니다. (첫 번째 열에 검색할 단어들이 입력되어 있어야 합니다.)
* 프로그램 상단의 **[CSV 파일 불러오기]** 버튼을 누르거나, 화면에 CSV 파일을 **드래그 앤 드롭**하여 등록하세요.
* CSV 파일을 별도로 등록하지 않아도, 실행 파일과 같은 폴더의 **`default.csv`** 또는 프로그램에 내장된 기본 단어 목록이 자동으로 적용됩니다.

### 📌 Step 2. 검색 대상 파일 추가
* **[📁 검색 대상 파일]** 탭에서 점검할 **학생부 PDF** 또는 **Excel 파일**을 추가합니다.
* **[➕ 파일 추가]** 버튼을 이용하거나, 리스트 영역으로 파일을 **드래그 앤 드롭**하여 여러 개를 한 번에 추가할 수 있습니다.

> **📥 나이스(NEIS)에서 파일 준비하기**
> * **Excel:** 나이스(NEIS) ▷ 학급담임 ▷ 학생부 ▷ 학교생활기록부 ▷ 학생부 항목별 조회 ▷ [저장] 버튼 ▷ **XLS data**
> * **PDF:** 인쇄 ▷ 프린터 선택 ▷ PDF로 저장. 텍스트를 검색할 수 있는 원본 파일만 가능합니다. **(※ 이미지 형태의 스캔본 불가능)**

### 📌 Step 3. 처리 시작 및 확인
* 파일이 모두 준비되면 우측 하단의 **`▶ 처리 시작`** 버튼을 클릭합니다.
* 진행 상황과 상세 결과(성공/실패 등)는 **[📜 시스템 로그]** 탭에서 실시간으로 확인할 수 있습니다.
* 처리 중에는 **`⛔ 중지`** 버튼을 눌러 작업을 강제로 중단할 수 있습니다.

> **💡 팁:** 리스트에 추가된 파일을 삭제하려면 해당 파일 우측의 `✖` 버튼을 누르거나, **[🗑 전체 비우기]**를 통해 목록을 초기화할 수 있습니다.

### 📌 Step 4. 결과 파일 활용법
* 점검이 완료되면 원본 파일과 같은 폴더에 **`output_`**이 붙은 결과 파일이 생성됩니다.
* **PDF:** 단어에 **노란색 하이라이트**가 칠해지며, 왼쪽 **북마크(목차)** 메뉴를 통해 발견 위치로 즉시 이동할 수 있습니다.
* **Excel:** 가장 오른쪽에 '발견여부'와 '발견된 단어' 컬럼이 추가되며, 해당 행 전체가 **노란색**으로 강조됩니다.

---

## ℹ️ 프로그램 정보

* **제작자:** 운양고등학교 이종환T
* **공식 홈페이지:** [luminousky.com](https://luminousky.com/teacher-utility-kit/neis-wordfinder/)
* **문의:** [hello@luminousky.com](mailto:hello@luminousky.com)

---

## 🛠️ 개발 및 기술 정보

### 📌 기술 스택
* **UI/프레임워크:** `Tauri 2` + `Vue 3` (Composition API) + `Tailwind CSS v4`
* **PDF 처리:** `pdfjs-dist` (텍스트 위치 추출) + `pdf-lib` (하이라이트·북마크 생성)
* **Excel 처리:** `SheetJS` (읽기) + `ExcelJS` (쓰기·노란색 행 강조)
* **상태 관리:** `Pinia`
* **무거운 처리:** Web Worker (`processor.worker.js`) — 순수 로직은 `src/workers/lib/`에 분리
* **테스트:** `Vitest`

### 📌 개발 명령어

```bash
npm install       # 의존성 설치
npm run dev       # 개발 서버
npm run tauri dev # 데스크톱 앱으로 실행

npm run ci        # 전체 검사 (아키텍처 검사 → 테스트 → 빌드)
npm run test      # 테스트만
npm run test:watch
```

### 📌 검사 (CI)

`npm run ci` 한 줄이 **관문의 정의**입니다. 아키텍처 검사 → Vitest → 프런트엔드 빌드를 순서대로 돌리고,
`.github/workflows/ci.yml`(push·PR)과 `publish.yml`(릴리즈)은 모두 이 한 줄만 호출합니다.
검사를 추가할 때는 워크플로가 아니라 `package.json`의 `ci` 스크립트에 넣어야 관문에서 누락되지 않습니다.

| 검사 | 내용 |
| --- | --- |
| `scripts/check-architecture.mjs` | `CLAUDE.md`의 아키텍처 규칙(컴포넌트의 Tauri IPC, 인라인 `style=`/`:style=`, `<style>` 하드코딩, 빈 `catch`, 정규식 lookbehind 등)을 기계로 강제 |
| `tests/check-architecture.spec.js` | **검사기 자체의 검사** — 별칭 import·`:style` 바인딩·여러 줄 빈 catch 같은 우회를 실제로 잡는지 |
| `tests/csv.spec.js` | 단어 CSV 인코딩 판별(UTF-8 / CP949 / UTF-16)과 RFC4180 파싱 |
| `tests/keywords.spec.js` | 단어 매칭 정규식, NFC 정규화, 연속 공백 검사 |
| `tests/keyword-lists.spec.js` | `default.csv`와 내장 단어 목록이 어긋나지 않는지 |
| `tests/excel.spec.js` | 시트 결과 컬럼 재생성, 날짜 셀 보존 |
| `tests/paths.spec.js` | 파일명·확장자·`output_` 경로 계산 |
| `tests/pdf-highlight.spec.js` | 하이라이트 좌표 계산, 아이템 경계 판정, 어노테이션·북마크 구조 |
| `tests/pdf-pipeline.spec.js` | PDF 생성 → 하이라이트 → **실제 렌더링해 노란 픽셀 확인** |

Rust는 `ci.yml`의 별도 잡에서 `cargo fmt --check` + `cargo clippy -- -D warnings` + `cargo test`로 검사합니다.
`publish.yml`에도 같은 Rust 관문이 있습니다 — publish는 임의 브랜치에서 dispatch할 수 있어서,
PR을 거치지 않은 코드가 린트 없이 배포되는 경로를 막습니다.

에러를 정말 삼켜야 하는 자리에는 `catch` 본문에 `의도적 무시: <이유>`를 남깁니다.
표식이 없는 빈 `catch`는 관문에서 실패합니다.

> **하이라이트 관련 수정은 반드시 회귀 테스트를 함께 추가하세요.**
> 어노테이션이 정상적으로 들어가 있는데 화면에만 안 보이는 버그가 실제로 있었습니다.
> 구조 검사만으로는 못 잡으므로 `pdf-pipeline.spec.js`처럼 렌더링 결과까지 확인해야 합니다.

### 📌 릴리즈 절차

1. `src-tauri/tauri.conf.json`의 `version`을 올립니다. (형식: `YYYY.M.D`)
2. 커밋 후 `main`에 푸시합니다.
3. GitHub Actions에서 **publish** 워크플로를 수동 실행합니다.
   * `npm run ci`를 통과하고 같은 버전의 릴리즈가 없어야 빌드가 시작됩니다.
   * Windows 포터블 zip과 macOS dmg를 만들어 **draft 릴리즈**로 올립니다.
4. draft 릴리즈의 노트를 정리하고 직접 publish 합니다.

---

## ⚖️ 라이선스 (License)

본 프로그램은 배포 버전에 따라 적용되는 라이선스가 다릅니다.

### 1. 버전별 라이선스 이력
* **초기 릴리즈 ~ ver.2026.04.01-1450**: LGPLv3
* **ver.2026.04.26-0315 ~ 현재**: PolyForm Noncommercial License 1.0.0

### 2. 현재 적용 라이선스
본 프로그램의 최신 버전은 **PolyForm Noncommercial License 1.0.0**을 따릅니다.

* **허용**: 개인적인 용도, 학교 등 교육기관에서의 비영리적 목적의 사용 및 배포
* **금지**: 본 프로그램이나 소스코드를 활용한 모든 종류의 상업적 영리 활동(판매, 유료 서비스 제공, 기업 내 이익 창출 등)은 엄격히 금지

### 3. 참고 (기존 버전 사용자)
버전 코드 'ver.2026.04.01-1450'까지의 프로그램을 사용 중이신 경우, 해당 버전은 배포 당시 명시된 **LGPLv3** 라이선스 조건을 따릅니다. 이후 릴리즈된 모든 신규 버전은 **PolyForm Noncommercial** 라이선스가 적용됩니다.

---

#### Copyright 2026. All rights reserved.
