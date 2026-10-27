# AI 면접 코치 — 프로젝트 규칙 (개발 직군 · Netlify + Gemini판)

> 이 파일을 프로젝트 맨 위 폴더 `d10-interview/CLAUDE.md` 에 넣고 Claude Code를 새로 시작해요. `d10-interview` 가 곧 깃 저장소예요.
> 맨 아래 "실수에서 배운 규칙"에 오늘 찾은 AI 실수를 한 줄씩 더해요.

## 무엇을 만드나
- 클래스로(가상 회사) **개발 직군 신입** 모의면접 웹 서비스. 시작 화면에서 **트랙 선택: 프론트엔드 · 백엔드 · 풀스택**. 순수 HTML · CSS · JS 화면 + Netlify Functions + **Gemini API (무료 등급)**
- 흐름: 시작(이름 · 트랙 · 회사 · 내 경험) → **공고 · NCS로 질문 출제** → 면접 5문제(꼬리 질문 포함) → 위원 4명 평가 → 고친 답 → 재도전 비교 → 리포트
- 배포: Netlify (GitHub 연결)

## 왜 서버 함수가 필요한가
- 브라우저에 내려가는 HTML · JS는 누구나 열어볼 수 있다. 무료 키라도 노출되면 남이 내 한도를 다 써 버린다.
- 그래서 **Gemini 호출과 키는 Netlify Functions(서버)에만** 둔다.

## 폴더 구조 (이 구조를 지켜, `d10-interview` 가 깃 저장소 맨 위)
```
d10-interview/
├─ public/                  ← 브라우저에 배포되는 화면
│  ├─ index.html
│  ├─ style.css
│  ├─ app.js
│  ├─ coach.js
│  └─ data/questions.csv
├─ netlify/functions/       ← 서버에서만 실행
│  ├─ prompts.mjs
│  ├─ ask.mjs
│  └─ data/track_context.json  ← 트랙별 NCS 능력단위 · 공고 요약
├─ netlify.toml
├─ package.json
├─ .env                     ← 내가 직접 만든다. 커밋 금지
├─ .env.example             ← 이름과 안내만, 값 없음
└─ .gitignore
```

| 파일 | 하는 일 | 하지 않는 일 |
| --- | --- | --- |
| `netlify/functions/prompts.mjs` | 프롬프트 문자열 · `PERSONA`(개발 리드 공통 1개) · `TRACK_FOCUS`(트랙 3개) · `TRACKS`(허용 목록) · JSON 스키마만 | API 호출 |
| `netlify/functions/ask.mjs` | Gemini 호출 **한 곳**. task 이름으로 프롬프트를 골라 채우고 JSON을 돌려준다 | 화면 코드 · 점수 계산 |
| `public/coach.js` | 질문 고르기 · 점수 자르기 · 합계 · 평균 · 비교 · 리포트 글 (AI 없이 계산) | fetch 호출 |
| `public/app.js` | 화면 그리기 · 상태 관리 · `/.netlify/functions/ask` 호출 | 프롬프트 문자열 · 점수 계산 |
| `netlify/functions/data/track_context.json` | 트랙별 NCS 능력단위 · 공고 요약(주요업무 · 자격요건 · 우대사항 · 기술스택) | 프롬프트 문장 · 공고 원문 |
| `public/data/questions.csv` | 질문 은행 (칸: 직군, 유형, 질문, 보는 점). '공통'의 자기소개 + '개발' 줄(AI 출제 실패 시 대신)만 쓴다 | 다른 직군 줄, 직무 밖 공통 질문 사용 |

## 서버 호출 규칙
- 브라우저는 `POST /.netlify/functions/ask` 에 `{ task, vars }` 만 보낸다. **브라우저가 프롬프트 문장을 보내지 않는다**
- task 목록: `make_questions` · `interviewer` · `eval_panel` · `eval_answer` · `retry` · `refine_question`. 목록에 없으면 400
- 트랙은 `frontend` · `backend` · `fullstack` 세 값만 받는다. 목록에 없으면 400. **브라우저가 보낸 글자를 프롬프트에 그대로 넣지 않고**, `prompts.mjs` 의 `TRACKS` 에서 한국어 이름과 `TRACK_FOCUS` 문장을 골라 넣는다
- `{persona}` 는 `PERSONA` + 고른 트랙의 `TRACK_FOCUS`, `{job}` 은 '프론트엔드 개발' 같은 트랙 이름으로 서버가 채운다
- `{ncs}` 는 `track_context.json` 의 `common.ncs` + 고른 트랙의 `ncs`, `{posting}` 은 고른 트랙의 `posting` 을 서버가 글로 바꿔 채운다. 공고 칸이 모두 비면 '공고 정보 없음'. `sources` 는 프롬프트에 넣지 않는다
- 입력 길이 제한: 답변 1개 2000자, 경험 1000자. 넘으면 400과 한국어 안내
- Gemini 호출은 `@google/genai` 패키지 하나로:
  - `ai.models.generateContent({ model, contents, config })`
  - `config.systemInstruction` 에 프롬프트, `config.responseMimeType = "application/json"`, `config.responseJsonSchema` 에 스키마
  - 결과는 `response.text` 를 `JSON.parse`. 파싱 실패하면 한국어 에러
- 스키마는 모든 칸을 `required` 에 넣는다 (빠뜨리면 AI가 칸을 건너뛸 수 있다)
- 모델 이름은 `process.env.GEMINI_MODEL`. 코드에 모델 이름을 박아 넣지 않는다
- 에러는 한국어 한 줄로 돌려준다: 키 없음 / 키 틀림 / 무료 한도 초과(429) / 연결 실패 / 시간 초과 / 응답 형식 오류

## 무료 등급 규칙
- 한도는 **키가 아니라 프로젝트 단위**로 걸린다. 분당 요청 수가 넉넉하지 않으니 **AI 호출을 동시에 여러 개 보내지 않는다** (평가도 하나씩 차례로)
- 429가 오면 한 번만 몇 초 쉬고 다시 시도. 그래도 안 되면 "무료 사용 한도를 넘었어요. 잠시 후 다시 시도해 주세요" 안내
- 무료 등급은 보낸 내용이 Google 서비스 개선에 쓰일 수 있다. 면접 기록에 **실제 개인정보 · 실제 회사 기밀 금지**를 시작 화면에 한 줄로 안내

## 프롬프트 규칙
- **프롬프트는 내가 쓴다.** Claude Code는 `prompts.mjs` 의 문장을 바꾸지 말고, 바꾸고 싶으면 제안만 해
- AI 출력은 모두 JSON 스키마로 받는다. 글로 받아서 잘라 쓰지 않는다
- 상황 블록(회사 · 직군(트랙) · 내 경험)은 `CONTEXT` 하나로 만들어 모든 프롬프트에 넣는다
- `{중괄호}` 칸은 `ask.mjs` 가 채운다. 칸 이름과 JSON 칸 이름은 바꾸지 않는다
- 지원자가 쓰지 않은 경험 · 숫자 · 회사 정보는 지어내지 않는다. 필요하면 `[확인 필요: ○○]`

## AI는 판단, 코드는 계산
- **직무 면접이다.** 인성 · 지원 동기 · 갈등 같은 직무 밖 질문은 쓰지 않는다. 질문 은행의 '공통' 줄은 자기소개 하나만 쓴다
- 질문 구성은 코드가 정한다: 자기소개 1 + 직무 2 + 경험 1 + 상황 1
  - 자기소개: `questions.csv` 에서 (`coach.js` 의 `pickIntro(rows)`)
  - 직무 2 · 경험 1 · 상황 1: 면접 시작 때 `make_questions` 를 **한 번** 불러 AI가 출제
  - AI가 낸 질문은 `coach.js` 의 `checkGenerated(list, allowedBasis)` 가 검사: 직무 2 · 경험 1 · 상황 1 개수가 맞는가, 질문 80자 이내인가, `basis` 가 넘겨준 NCS · 공고 항목 중 하나와 글자가 같은가, `basis` 가 서로 다른가
  - 검사에 떨어진 질문이나 호출 실패는 `questions.csv` 의 '개발' 줄에서 같은 유형으로 대신한다. 면접은 멈추지 않는다
- 질문 개수(5)와 순서, **꼬리 질문 최대 1개**는 `coach.js` 상수(`TOTAL_QUESTIONS=5`, `MAX_FOLLOW_UPS=1`)와 `app.js` 가 정한다. AI가 더 묻자고 해도 코드가 막는다
- 점수 **합계 · 평균 · 전후 차이는 `coach.js` 가** 계산한다. AI가 쓴 합계는 쓰지 않는다
- 이해도: AI는 **답 하나의** 이해도만 준다. 상태창에 보이는 이해도는 `coach.js` 가 지금까지 받은 값의 평균으로 계산한다
- 점수는 범위 밖이면 잘라 쓴다 (기준 0~5, 위원 0~10, 이해도 0~100)
- 고친 답은 답변 점수 14점 미만인 답만 보여 준다
- 평가는 **`eval_panel` 1번 + `eval_answer` 답변마다** 나눠서 **차례로** 부른다 (함수 실행 시간 제한 + 무료 한도 때문)

## 화면 규칙
- 순수 HTML · CSS · JS. 프레임워크 · 빌드 도구 없이. 외부 라이브러리가 필요하면 먼저 물어봐
- 면접은 채팅 말풍선 형태, 대화 기록은 `app.js` 의 `state` 객체 하나
- 상태창: 질문 n/5 진행 막대 · 면접관이 본 이해도 · 처음부터 다시
- 에러는 화면에 한국어 한 줄. 키 · 요청 내용은 화면과 `console.log` 에 찍지 않는다
- 버튼을 `disabled` 로 막지 말고, 누른 뒤 빈칸이면 안내 문장
- AI 기다리는 동안 안내 표시, 평가는 "평가 중 2/6"처럼 진행 표시
- 사용자 입력을 화면에 넣을 때는 `textContent` (innerHTML 금지)
- 모바일에서도 보이게

## 보안
- 키는 `.env` 의 `GEMINI_API_KEY`, 모델은 `GEMINI_MODEL`. `.env` 는 `.gitignore`, `.env.example` 은 이름과 안내만
- 배포 시 키는 Netlify 사이트 설정의 **환경 변수**에. `public/` 폴더 어디에도 키 금지
- 모델을 바꾸려면 먼저 말해

## 끝나면 스스로 점검 (표로 알려 줘)
| 점검 | 확인 방법 |
| --- | --- |
| Gemini 호출이 `ask.mjs` 한 곳인가 | `Ctrl+Shift+F` 로 `GoogleGenAI` · `generativelanguage` 검색 |
| 프롬프트가 `prompts.mjs` 에만 있나 | `public/` 에 긴 프롬프트 문자열 없음 |
| 키가 `public/` 에 없나 | `GEMINI_API_KEY` · `AIza` 검색 시 `public/` 0건 |
| AI 출제 질문을 코드가 검사하나 | `basis` 를 목록에 없는 말로 바꿔 보면 CSV 질문으로 대신됨 |
| 꼬리 질문 최대 1개를 코드가 지키나 | 짧게 답해도 질문당 꼬리 질문 1개까지 |
| 점수 합계를 코드가 다시 계산하나 | `coach.js` 함수 |
| AI 호출이 동시에 나가지 않나 | 평가 중 Network 탭에서 `ask` 요청이 하나씩 |
| 트랙 값을 서버가 목록으로만 받나 | 개발자 도구에서 track 을 `hacker` 로 바꿔 보내면 400 |
| `.env` 가 `git status` 에 안 보이나 | |

## 실수에서 배운 규칙
<!-- - (10/27) ___ (왜: ___) → 검사: ___ -->
