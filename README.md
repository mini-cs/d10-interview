# AI 면접 코치 — 개발 직군 신입 모의면접

가상 회사 **클래스로**(원데이 클래스 플랫폼)의 개발 직군 신입 모의면접 웹 서비스입니다.
트랙(프론트엔드 · 백엔드 · 풀스택)을 고르면 채용 공고 요약과 NCS 능력단위로 AI가 질문을 내고, 꼬리 질문이 있는 면접 → 위원 4명 평가 → 재도전 비교 → 리포트까지 이어집니다.

- 배포: https://d10-interview.netlify.app
- 스택: 순수 HTML · CSS · JS (프레임워크 · 빌드 도구 없음) + Netlify Functions + Gemini API(`@google/genai`, 무료 등급)

## 설계 원칙

| 원칙 | 내용 |
| --- | --- |
| 키는 서버에만 | Gemini 호출과 API 키는 Netlify Function(`ask.mjs`) 한 곳에만 있다. 브라우저는 `{ task, vars }` 만 보내고 프롬프트 문장은 보내지 않는다 |
| AI는 판단, 코드는 계산 | 질문 개수 · 순서 · 꼬리 질문 횟수 · 점수 합계 · 평균 · 전후 차이는 `coach.js` 가 계산한다. AI가 쓴 합계는 쓰지 않고, 범위 밖 점수는 잘라 쓴다 |
| AI 출력은 JSON 스키마로 | 모든 응답은 `responseJsonSchema` 로 받고, 스키마의 모든 칸은 `required` |
| AI 출제는 코드가 검사 | AI가 낸 질문은 `checkGenerated()` 가 검사하고, 떨어지면 질문 은행(CSV)으로 대신한다. 면접은 멈추지 않는다 |
| 무료 한도 보호 | AI 호출은 동시에 보내지 않는다. 평가 6건도 하나씩 차례로 |
| 프롬프트는 사람이 쓴다 | `prompts.mjs` 의 문장은 사람이 쓰고 고친다. 코드 작업에서 문장을 바꾸지 않는다 |

프로젝트 규칙 전체는 [`CLAUDE.md`](CLAUDE.md) 에 있습니다.

## 폴더 구조

```
d10-interview/
├─ public/                         브라우저에 배포되는 화면
│  ├─ index.html                   시작 · 면접 · 평가 · 재도전 · 질문 다듬기 화면
│  ├─ style.css
│  ├─ app.js                       화면 그리기 · 상태(state) · /.netlify/functions/ask 호출
│  ├─ coach.js                     AI 없이 하는 계산 (fetch 없음)
│  └─ data/questions.csv           질문 은행 (직군, 유형, 질문, 보는 점)
├─ netlify/functions/              서버에서만 실행
│  ├─ ask.mjs                      Gemini 호출 한 곳
│  ├─ prompts.mjs                  프롬프트 · TRACKS · JSON 스키마
│  └─ data/track_context.json      트랙별 NCS 능력단위 · 공고 요약
├─ netlify.toml
├─ package.json
├─ .env.example                    환경 변수 이름과 안내 (값 없음)
└─ CLAUDE.md                       프로젝트 규칙 · 실수에서 배운 규칙
```

## 로컬 실행

```bash
npm install -g netlify-cli
npm install
cp .env.example .env     # GEMINI_API_KEY, GEMINI_MODEL 값을 채운다
netlify dev              # http://localhost:8888
```

| 환경 변수 | 설명 |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio에서 발급한 키 |
| `GEMINI_MODEL` | AI Studio에서 확인한 무료 등급 모델 이름. 코드에 모델 이름을 넣지 않는다 |

`.env` 는 `.gitignore` 에 들어 있어 커밋되지 않습니다.

## 화면 흐름

1. **시작**: 이름 · 트랙 · 회사(기본 '클래스로') · 내 경험(30~1000자)
   - (선택) **실제 회사 공고로 맞추기**: 공고 원문을 붙여 `summarize_posting` 으로 키워드 4칸을 만들고, 확인 · 수정한 뒤 시작. 비워 두면 기본 공고 요약으로 출제
2. **출제**: `make_questions` 1번 → `checkGenerated()` → `fillMissing()`
   → 순서는 자기소개(CSV) · 직무 · 직무 · 경험 · 상황. 질문마다 출처(`AI 출제` / `질문 은행`)를 기록
3. **면접**: 답마다 `interviewer` 호출. 꼬리 질문은 질문당 최대 1번(`MAX_FOLLOW_UPS`)이고, AI가 더 묻자고 해도 코드가 넘긴다. 상태창에 질문 n/5 · 이해도 평균
4. **평가**: `eval_panel` 1번 → `eval_answer` 5번을 차례로. 실패한 칸만 '다시 시도'. 답변 점수 14점 미만일 때만 고친 답 · 확인할 것을 보여 줌
5. **재도전**: 점수 낮은 순으로 질문을 골라 다시 답하기 → `retry` → `compare()` 로 전 → 후 비교
6. **마지막 질문 다듬기**: `refine_question` 으로 면접관에게 할 질문 3개(회사 · 직무 · 성장)
7. **리포트**: `buildReport()` 로 `면접리포트.md` 를 만들어 Blob으로 내려받기

## 서버 API

`POST /.netlify/functions/ask`

```json
{ "task": "interviewer", "vars": { "track": "frontend", "company": "클래스로", "experience": "...", "question": "...", "point": "...", "can_follow_up": "예", "turns": [{ "role": "interviewer", "text": "..." }, { "role": "candidate", "text": "..." }] } }
```

| task | 프롬프트 · 스키마 | contents 로 가는 것 | 응답 |
| --- | --- | --- | --- |
| `make_questions` | `QUESTION_MAKER` · `QUESTIONS_SCHEMA` | 고정 문장 | `questions[4]` + `allowedBasis` |
| `interviewer` | `INTERVIEWER` · `INTERVIEWER_SCHEMA` | 이 질문의 대화(`turns`, 최대 6) | `reply`, `follow_up`, `understanding` |
| `eval_panel` | `EVAL_PANEL` · `EVAL_PANEL_SCHEMA` | 면접 전체 질문 · 꼬리 질문 · 답(`turns`, 최대 30) | `panel[4]`, `conflict`, `agree`, `next[3]` |
| `eval_answer` | `EVAL_ANSWER` · `EVAL_ANSWER_SCHEMA` | 본 답 + 꼬리 질문과 답 | 기준 4개, `weak`, `rewrite`, `check[]` |
| `retry` | `RETRY` · `RETRY_SCHEMA` | 다시 쓴 답(`vars.answer`) | 기준 4개, `weak` |
| `refine_question` | `REFINE_QUESTION` · `REFINE_SCHEMA` | 지원자가 쓴 질문(`vars.answer`) | `questions[3]`, `why` |
| `summarize_posting` | `SUMMARIZE_POSTING` · `POSTING_SCHEMA` | 공고 원문(`vars.posting_text`, 저장 안 함) | `주요업무` · `자격요건` · `우대사항` · `기술스택` 각 최대 6개 |

서버가 채우는 프롬프트 칸:

| 칸 | 값 |
| --- | --- |
| `{persona}` | `PERSONA` + `TRACK_FOCUS[track]` |
| `{job}` | `TRACKS[track]` + ' 개발' |
| `{ncs}` | `track_context.json` 의 `common.ncs` + 트랙 `ncs` |
| `{posting}` | `vars.posting`(지원자가 입력한 공고)이 있으면 그것, 없으면 트랙 `posting`. 모두 비면 '공고 정보 없음' |
| `{company_note}` | 입력한 공고가 있으면 `COMPANY_NOTE.custom`, 없으면 `COMPANY_NOTE.default` |
| `{트랙 이름}` | `TRACKS[track]` (`summarize_posting` 용) |
| `{context}` | `CONTEXT` 에 회사 · 직군 · 공고 · NCS · 경험을 채운 블록 |
| `{question}` · `{point}` · `{can_follow_up}` | `vars` 에서 (`can_follow_up` 은 '예' 아니면 '아니오') |

`allowedBasis` 는 이번에 넘긴 NCS · 공고 항목 전체 목록입니다. 브라우저의 `checkGenerated()` 가 출제 질문의 `basis` 를 이 목록과 글자 단위로 비교합니다. `sources` 는 프롬프트에 넣지 않습니다.

**입력 검증 (400)**: 목록에 없는 task · 트랙(`frontend` · `backend` · `fullstack` 만), 경험 1000자 초과, 답변 2000자 초과, 공고 원문 5000자 초과, 공고 항목 30자 초과 · 칸마다 6개 초과, `turns` 형식 오류 · 개수 초과, 빈 답변

**에러 (한국어 한 줄 `{ "error": "..." }`)**

| 상황 | 상태 코드 |
| --- | --- |
| 키 · 모델 설정 없음 | 500 |
| 키 틀림 · 모델 이름 없음 | 500 |
| 무료 한도 초과 (4초 쉬고 1번 다시 시도한 뒤) | 429 |
| 연결 실패 · 기타 API 오류 | 502 |
| 시간 초과 (호출당 25초) | 504 |
| 응답 JSON 파싱 실패 | 502 |

## coach.js

| 이름 | 하는 일 |
| --- | --- |
| `TOTAL_QUESTIONS = 5`, `MAX_FOLLOW_UPS = 1` | 질문 수 · 질문당 꼬리 질문 수 |
| `parseCsv(text)` | 따옴표 안 쉼표 · `""` · BOM · CRLF 를 처리하는 작은 CSV 파서 |
| `pickIntro(rows)` | 직군 '공통' 중 '자기소개' 줄 하나 (다른 공통 질문은 쓰지 않음) |
| `checkGenerated(list, allowedBasis)` | 유형별 개수(직무 2 · 경험 1 · 상황 1), 질문 80자 이내, `basis` 가 목록에 있고 서로 다른지 검사해 통과한 것만 |
| `fillMissing(passed, rows)` | 빈자리를 '개발' 줄의 같은 유형으로 무작위로 채워 직무 · 직무 · 경험 · 상황 순서로 |
| `clamp(value, min, max)` | 범위 밖 · 숫자 아닌 값 잘라 쓰기 |
| `averageUnderstanding(list)` | 답마다 받은 이해도의 평균 |
| `panelAverage(panel)` | 위원 점수(0~10)의 평균. 반올림하지 않음 |
| `answerTotal(result)` | 기준 4개(각 0~5) 합 0~20 |
| `REWRITE_BELOW = 14` | 이 점수 미만일 때만 고친 답 표시 |
| `compare(before, after)` | 재도전 전 · 후 합계, 차이(`+3`), 기준별 전/후 |
| `buildReport(state)` | `면접리포트.md` 글 |

## 배포 (Netlify + GitHub)

1. GitHub 저장소를 Netlify 사이트에 연결한다. `netlify.toml` 이 `publish = "public"`, `functions = "netlify/functions"` 를 알려 주므로 Base directory 는 비워 둔다
2. 사이트 설정 → Environment variables 에 `GEMINI_API_KEY`, `GEMINI_MODEL` 을 넣고 다시 배포한다
3. `main` 에 push 하면 자동으로 빌드 · 배포된다

함수 번들러는 esbuild(`netlify.toml` 의 `[functions] node_bundler`)입니다. `ask.mjs` 가 `track_context.json` 을 import 하므로 JSON이 함수 번들 안에 함께 들어갑니다. 배포 후 확인 방법: 면접을 시작하고 Network 탭의 `ask` 응답에 `allowedBasis` 가 들어 있는지 봅니다.

**배포할 때 막혔던 것**

- 401 + Netlify 로그인 화면 → Project configuration → Access & security → Visitor access 를 공개로
- 빌드 로그에 "Repository not found" → GitHub의 Netlify 앱에 이 저장소 접근 권한 추가

## 점검

| 점검 | 방법 |
| --- | --- |
| Gemini 호출이 한 곳인가 | `GoogleGenAI` 검색 결과가 `ask.mjs` 뿐 |
| 키가 저장소에 없나 | `AIza` · `AQ.` · `.env` 의 실제 값으로 검색해 0건, `git status` 에 `.env` 없음 |
| 트랙 허용 목록 | `track: "hacker"` 로 보내면 400 |
| 출제 검사 | `basis` 를 목록 밖 말로 바꾸면 CSV 질문으로 대신됨 |
| 꼬리 질문 제한 | "네."처럼 짧게 답해도 질문당 꼬리 질문 1개 |
| 평가가 차례로 가는가 | 평가 중 Network 탭에서 `ask` 요청이 하나씩 |
| 위원 평균 | 위원 점수 4개 합 ÷ 4 와 화면 값이 같음 |

## 알려진 한계

- **무료 등급**: 한도는 키가 아니라 AI Studio 프로젝트 단위입니다. 하루 한도가 끝나면 초기화될 때까지 429가 납니다. 보낸 내용이 Google 서비스 개선에 쓰일 수 있어 시작 화면에서 실제 개인정보 · 회사 기밀을 적지 말라고 안내합니다
- **공개 함수**: 배포 주소를 아는 누구나 함수를 불러 무료 한도를 쓸 수 있습니다. task · 트랙 허용 목록과 입력 길이 제한만 있고, 호출 횟수 제한은 없습니다
- **`prompts.mjs` 도 함수로 배포됨**: Netlify는 `netlify/functions/` 바로 아래 `.mjs` 를 모두 함수로 올립니다. `/.netlify/functions/prompts` 는 에러를 낼 뿐 프롬프트를 노출하지는 않습니다
- **프롬프트로만 막는 규칙**: 꼬리 질문 60자, 고친 답 4문장, 마지막 질문 50자, 지어내기 금지는 코드로 검사하지 않습니다
- **브라우저 상태만 사용**: 면접 기록은 `app.js` 의 `state` 에만 있어 새로고침하면 사라집니다. 남기려면 리포트를 내려받아야 합니다
