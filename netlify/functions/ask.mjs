import { GoogleGenAI } from '@google/genai';
// JSON을 import 하면 번들러가 함수 파일 안에 함께 넣는다 (배포 후 파일 누락 없음)
import trackContext from './data/track_context.json' with { type: 'json' };
import {
  TRACKS, PERSONA, TRACK_FOCUS, CONTEXT, INTERVIEWER, QUESTION_MAKER, EVAL_PANEL, EVAL_ANSWER, RETRY,
  INTERVIEWER_SCHEMA, QUESTIONS_SCHEMA, EVAL_PANEL_SCHEMA, EVAL_ANSWER_SCHEMA, RETRY_SCHEMA,
} from './prompts.mjs';

const MAX_TURNS = 6;
const TASKS = {
  make_questions: { prompt: QUESTION_MAKER, schema: QUESTIONS_SCHEMA, maxTurns: 0 },
  interviewer: { prompt: INTERVIEWER, schema: INTERVIEWER_SCHEMA, maxTurns: MAX_TURNS },
  // 면접 전체 기록: 5문제 × 질문당 최대 6턴
  eval_panel: { prompt: EVAL_PANEL, schema: EVAL_PANEL_SCHEMA, maxTurns: MAX_TURNS * 5 },
  eval_answer: { prompt: EVAL_ANSWER, schema: EVAL_ANSWER_SCHEMA, maxTurns: MAX_TURNS },
  retry: { prompt: RETRY, schema: RETRY_SCHEMA, maxTurns: 0 },
};
const MAX_EXPERIENCE = 1000;
const MAX_ANSWER = 2000;
const TIMEOUT_MS = 25000;
const RETRY_WAIT_MS = 4000;

class UserError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (status, body) => Response.json(body, { status });
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (m, key) => values[key] ?? m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function text(value, label, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new UserError(400, `${label} 값이 올바르지 않아요.`);
  if (value.length > max) throw new UserError(400, `${label}: ${max}자 이내로 적어 주세요.`);
  return value.trim();
}

function trackMaterial(track) {
  const t = trackContext.tracks[track];
  const ncs = [...trackContext.common.ncs, ...t.ncs];
  const postingEntries = Object.entries(t.posting).filter(([, items]) => items.length > 0);
  const posting = postingEntries.length
    ? postingEntries.map(([k, items]) => `${k}: ${items.join(', ')}`).join(' / ')
    : '공고 정보 없음';
  const allowedBasis = [...ncs, ...postingEntries.flatMap(([, items]) => items)];
  return { ncs: ncs.join(', '), posting, allowedBasis };
}

function readTurns(turns, maxTurns) {
  if (turns === undefined) return [];
  if (!Array.isArray(turns) || turns.length > maxTurns) throw new UserError(400, '대화 기록 형식이 올바르지 않아요.');
  return turns.map((t) => {
    if (t?.role !== 'interviewer' && t?.role !== 'candidate') throw new UserError(400, '대화 기록 형식이 올바르지 않아요.');
    return { role: t.role, text: text(t.text, '답변', MAX_ANSWER) };
  });
}

function geminiError(err) {
  const status = err?.status;
  const msg = String(err?.message ?? '');
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return new UserError(504, 'AI 응답 시간이 초과됐어요. 다시 시도해 주세요.');
  if (status === 429) return new UserError(429, '무료 사용 한도를 넘었어요. 잠시 후 다시 시도해 주세요.');
  if (status === 401 || status === 403 || /API key/i.test(msg)) return new UserError(500, 'Gemini API 키가 틀렸어요. GEMINI_API_KEY 를 확인해 주세요.');
  if (status === 404) return new UserError(500, '모델 이름을 찾을 수 없어요. GEMINI_MODEL 을 확인해 주세요.');
  if (!status) return new UserError(502, 'AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return new UserError(502, `AI 호출에 실패했어요 (코드 ${status}).`);
}

async function callGemini(request) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await ai.models.generateContent({
        ...request,
        config: { ...request.config, abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      });
      return response.text;
    } catch (err) {
      if (err?.status === 429 && attempt === 0) { await sleep(RETRY_WAIT_MS); continue; }
      throw geminiError(err);
    }
  }
}

async function handle(req) {
  if (req.method !== 'POST') throw new UserError(405, 'POST 요청만 받아요.');
  const body = await req.json().catch(() => null);
  const task = TASKS[body?.task];
  if (!task) throw new UserError(400, '알 수 없는 요청(task)이에요.');
  const vars = body.vars ?? {};
  if (!Object.hasOwn(TRACKS, vars.track)) throw new UserError(400, '트랙은 프론트엔드 · 백엔드 · 풀스택 중에서 골라 주세요.');
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) {
    throw new UserError(500, '서버에 GEMINI_API_KEY 또는 GEMINI_MODEL 설정이 없어요.');
  }

  const { ncs, posting, allowedBasis } = trackMaterial(vars.track);
  const values = {
    company: text(vars.company, '회사 이름', 100) || '클래스로',
    job: `${TRACKS[vars.track]} 개발`,
    experience: text(vars.experience, '경험', MAX_EXPERIENCE),
    ncs,
    posting,
  };
  // 한 번에 치환해야 사용자가 적은 글 속 {중괄호}가 다시 채워지지 않는다
  const prompt = fill(task.prompt, {
    ...values,
    context: fill(CONTEXT, values),
    persona: `${PERSONA}\n${TRACK_FOCUS[vars.track]}`,
    question: text(vars.question, '질문', 300),
    point: text(vars.point, '보는 점', 300),
    can_follow_up: vars.can_follow_up === '예' ? '예' : '아니오',
  });

  const turns = readTurns(vars.turns, task.maxTurns);
  let contents;
  if (body.task === 'make_questions') contents = '질문을 만들어 주세요.';
  else if (body.task === 'retry') contents = text(vars.answer, '답변', MAX_ANSWER); // 다시 쓴 답만
  else contents = turns.map((t) => `${t.role === 'candidate' ? '[지원자]' : '[면접관]'} ${t.text}`).join('\n');
  if (!contents) throw new UserError(400, '답변을 적어 주세요.');

  const raw = await callGemini({
    model: process.env.GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: prompt,
      responseMimeType: 'application/json',
      responseJsonSchema: task.schema,
    },
  });
  let result;
  try { result = JSON.parse(raw); } catch { throw new UserError(502, 'AI 응답 형식이 올바르지 않아요. 다시 시도해 주세요.'); }
  return body.task === 'make_questions' ? { ...result, allowedBasis } : result;
}

export default async (req) => {
  try {
    return json(200, await handle(req));
  } catch (err) {
    if (err instanceof UserError) return json(err.status, { error: err.message });
    return json(500, { error: '서버에서 알 수 없는 오류가 났어요.' });
  }
};
