// AI 없이 하는 계산만. fetch 호출 없음.

export const TOTAL_QUESTIONS = 5;
export const MAX_FOLLOW_UPS = 1;
const MAX_QUESTION_LENGTH = 80;
// 자기소개 뒤에 이어지는 순서와 개수
const PLAN = ['직무', '직무', '경험', '상황'];

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim()));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const fromRow = (r, type) => ({ type, question: r['질문'], point: r['보는 점'], basis: '', source: '질문 은행' });

export function pickIntro(rows) {
  const r = rows.find((x) => x['직군'] === '공통' && x['질문'].includes('자기소개'));
  return fromRow(r, '자기소개');
}

export function checkGenerated(list, allowedBasis) {
  if (!Array.isArray(list) || !Array.isArray(allowedBasis)) return [];
  const passed = [];
  const usedBasis = new Set();
  for (const q of list) {
    const quota = PLAN.filter((t) => t === q?.type).length;
    const ok = quota > passed.filter((p) => p.type === q.type).length
      && typeof q.question === 'string' && q.question.trim() && q.question.length <= MAX_QUESTION_LENGTH
      && allowedBasis.includes(q.basis) && !usedBasis.has(q.basis);
    if (!ok) continue;
    usedBasis.add(q.basis);
    passed.push({ type: q.type, question: q.question.trim(), point: String(q.point ?? ''), basis: q.basis, source: 'AI 출제' });
  }
  return passed;
}

// 결과는 PLAN 순서(직무 · 직무 · 경험 · 상황). 빈자리는 '개발' 줄에서 같은 유형으로 무작위
export function fillMissing(passed, rows) {
  const left = [...passed];
  const used = new Set(passed.map((p) => p.question));
  return PLAN.map((type) => {
    const i = left.findIndex((p) => p.type === type);
    if (i >= 0) return left.splice(i, 1)[0];
    const pool = rows.filter((r) => r['직군'] === '개발' && r['유형'] === type && !used.has(r['질문']));
    const r = pool[Math.floor(Math.random() * pool.length)];
    used.add(r['질문']);
    return fromRow(r, type);
  });
}

export function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

export function averageUnderstanding(list) {
  if (!list.length) return null;
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
}

// 서버 ask.mjs 와 같은 제한 (서버도 다시 검사한다)
export const POSTING_FIELDS = ['주요업무', '자격요건', '우대사항', '기술스택'];
const MAX_POSTING_ITEM = 30;
const MAX_POSTING_ITEMS = 6;

// 칸별 글(한 줄에 하나)을 공고 객체로. 모두 비면 posting 은 null
export function parsePosting(texts) {
  const posting = {};
  for (const field of POSTING_FIELDS) {
    const items = String(texts[field] ?? '').split('\n').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (items.length > MAX_POSTING_ITEMS) return { error: `공고 ${field}: 항목은 ${MAX_POSTING_ITEMS}개까지예요. (지금 ${items.length}개)` };
    const long = items.find((s) => s.length > MAX_POSTING_ITEM);
    if (long) return { error: `공고 ${field}: "${long.slice(0, 12)}…" 항목이 ${MAX_POSTING_ITEM}자를 넘어요.` };
    posting[field] = items;
  }
  return { posting: POSTING_FIELDS.some((f) => posting[f].length) ? posting : null };
}

// 이 점수 미만인 답만 고친 답을 보여 준다
export const REWRITE_BELOW = 14;
export const CRITERIA = [
  ['specific', '구체성'], ['relevance', '직무 연관'], ['structure', '구조'], ['evidence', '근거 · 검증'],
];

// 위원 점수(0~10)를 잘라 쓴 평균. 반올림하지 않아 손으로 나눈 값(예: 4.25)과 같다
export function panelAverage(panel) {
  if (!Array.isArray(panel) || !panel.length) return null;
  const sum = panel.reduce((a, p) => a + clamp(p?.score, 0, 10), 0);
  return sum / panel.length;
}

// 기준 4개(각 0~5)를 잘라 쓴 합계 0~20. AI가 쓴 합계는 쓰지 않는다
export function answerTotal(result) {
  return CRITERIA.reduce((a, [key]) => a + clamp(result?.[key], 0, 5), 0);
}

// 줄바꿈과 | 가 마크다운 목록 · 표를 깨지 않게
const md = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

// 면접리포트.md 글. 점수는 모두 이 파일의 함수로 다시 계산한 값만 쓴다
export function buildReport({ profile, questions, understanding, evaluation, retries }, date = new Date()) {
  const lines = [
    `# 면접 리포트 — ${profile.name}`,
    '',
    `- 날짜: ${date.toLocaleDateString('ko-KR')}`,
    `- 회사 · 트랙: ${profile.company} · ${profile.trackLabel} 개발`,
    `- 출제 공고: ${profile.posting ? '지원자가 입력한 공고' : '기본 공고 요약'}`,
    `- 면접관이 본 이해도 평균: ${averageUnderstanding(understanding) ?? '-'} / 100`,
    '',
    '## 위원 4명 평가',
  ];
  const panel = evaluation[0]?.data;
  if (panel) {
    lines.push('', `위원 평균: **${panelAverage(panel.panel)} / 10**`, '', '| 위원 | 점수 | 뽑지 말아야 할 이유 | 좋은 점 |', '| --- | --- | --- | --- |');
    for (const p of panel.panel) lines.push(`| ${md(p.role)} | ${clamp(p.score, 0, 10)} | ${md(p.against)} | ${md(p.good)} |`);
    lines.push('', `- 판단이 갈린 곳: ${md(panel.conflict)}`, `- 모두 같은 판단: ${md(panel.agree)}`, '', '### 다음 연습에서 고칠 것');
    panel.next.forEach((n, i) => lines.push(`${i + 1}. ${md(n)}`));
  } else {
    lines.push('', '평가 결과 없음');
  }

  lines.push('', '## 답변별 평가');
  questions.forEach((q, idx) => {
    const i = idx + 1;
    const result = evaluation[i]?.data;
    lines.push('', `### 질문 ${i} · ${q.type} (${q.source})`, '', `> ${md(q.question)}`, '');
    lines.push(`- 내 답: ${q.turns.filter((t) => t.role === 'candidate').map((t) => md(t.text)).join(' / ')}`);
    if (!result) { lines.push('- 평가 결과 없음'); return; }
    lines.push(`- 답변 점수: **${answerTotal(result)} / 20** (${CRITERIA.map(([k, label]) => `${label} ${clamp(result[k], 0, 5)}`).join(' · ')})`);
    lines.push(`- 약한 점: ${md(result.weak)}`);
    if (answerTotal(result) < REWRITE_BELOW) lines.push(`- 고친 답: ${md(result.rewrite)}`);
    const retry = retries[i];
    if (retry) {
      const c = compare(result, retry.data);
      lines.push(`- 재도전: ${c.before} → ${c.after} (${c.diffText})`, `- 재도전 답: ${md(retry.answer)}`);
    }
  });
  return lines.join('\n') + '\n';
}

// 재도전 전 → 후 비교. 같은 기준 4개로 잘라 쓴 점수끼리 비교한다
export function compare(before, after) {
  const beforeTotal = answerTotal(before);
  const afterTotal = answerTotal(after);
  const diff = afterTotal - beforeTotal;
  return {
    before: beforeTotal,
    after: afterTotal,
    diff,
    diffText: diff > 0 ? `+${diff}` : `${diff}`,
    rows: CRITERIA.map(([key, label]) => ({ label, before: clamp(before?.[key], 0, 5), after: clamp(after?.[key], 0, 5) })),
  };
}
