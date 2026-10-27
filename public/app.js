import {
  TOTAL_QUESTIONS, MAX_FOLLOW_UPS, parseCsv, pickIntro, checkGenerated, fillMissing,
  clamp, averageUnderstanding, panelAverage, answerTotal, compare, buildReport, REWRITE_BELOW, CRITERIA,
  POSTING_FIELDS, parsePosting,
} from './coach.js';

const MIN_EXPERIENCE = 30;
const MAX_EXPERIENCE = 1000;
const MAX_ANSWER = 2000;

const $ = (id) => document.getElementById(id);

// 대화 기록과 진행 상황은 모두 여기 하나에
const state = newState();

function newState() {
  return {
    session: 0,          // 처음부터 다시 누른 뒤 늦게 온 응답을 버리기 위한 번호
    busy: false,
    profile: null,       // { name, track, trackLabel, company, experience }
    questions: [],       // { type, question, point, basis, source, turns: [{ role, text }], followUps }
    index: 0,
    understanding: [],
    finished: false,
    // [0] 위원 평가, [1..5] 답변별 평가. 각 칸은 null(아직) · { data } · { error }
    evaluation: Array(TOTAL_QUESTIONS + 1).fill(null),
    retries: {},         // 질문 번호(1~5) → { answer, data } 마지막 재도전
  };
}

async function ask(task, vars) {
  let res;
  try {
    res = await fetch('/.netlify/functions/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 입력한 공고가 있으면 모든 호출에 같이 보낸다 (서버가 {posting} · allowedBasis 를 그 공고로 채움)
      body: JSON.stringify({ task, vars: { ...vars, posting: state.profile?.posting ?? undefined } }),
    });
  } catch {
    throw new Error('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error ?? '서버 응답을 읽지 못했어요.');
  return data;
}

function bubble(role, text, tag) {
  const div = document.createElement('div');
  div.className = `bubble ${role}`;
  if (tag) {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = tag;
    div.append(span);
  }
  div.append(document.createTextNode(text));
  $('chat').append(div);
  div.scrollIntoView({ block: 'nearest' });
  return div;
}

function setWaiting(text) {
  $('waiting').hidden = !text;
  $('waiting').textContent = text ?? '';
}

function renderStatus() {
  const shown = Math.min(state.index + 1, TOTAL_QUESTIONS);
  $('status-track').textContent = state.profile ? `트랙: ${state.profile.trackLabel}` : '';
  $('status-count').textContent = `질문 ${shown}/${TOTAL_QUESTIONS}`;
  $('status-progress').max = TOTAL_QUESTIONS;
  $('status-progress').value = state.finished ? TOTAL_QUESTIONS : state.index;
  const avg = averageUnderstanding(state.understanding);
  $('status-understanding').textContent = avg === null ? '-' : `${avg}`;
}

function showQuestion() {
  const q = state.questions[state.index];
  q.turns.push({ role: 'interviewer', text: q.question });
  bubble('interviewer', q.question, `질문 ${state.index + 1} · ${q.type}`);
  renderStatus();
  $('answer').focus();
}

function nextQuestion() {
  state.index += 1;
  if (state.index >= TOTAL_QUESTIONS) {
    state.finished = true;
    renderStatus();
    bubble('system', '면접이 끝났어요. 수고하셨어요.');
    $('answer-form').hidden = true;
    $('eval-screen').hidden = false;
    renderEvaluation();
    return;
  }
  showQuestion();
}

async function startInterview(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = event.target;
  const checked = form.querySelector('input[name="track"]:checked');
  const experience = form.experience.value.trim();
  const notice = $('start-notice');
  if (!checked) { notice.textContent = '트랙을 골라 주세요.'; return; }
  if (experience.length < MIN_EXPERIENCE) { notice.textContent = `내 경험을 ${MIN_EXPERIENCE}자 이상 적어 주세요. (지금 ${experience.length}자)`; return; }
  if (experience.length > MAX_EXPERIENCE) { notice.textContent = `내 경험은 ${MAX_EXPERIENCE}자 이내로 적어 주세요. (지금 ${experience.length}자)`; return; }
  const { posting, error } = parsePosting(postingTexts());
  if (error) { notice.textContent = error; $('posting-box').open = true; return; }
  notice.textContent = '';

  state.busy = true;
  const session = state.session;
  state.profile = {
    name: form.name.value.trim() || '지원자',
    track: checked.value,
    trackLabel: checked.parentElement.textContent.trim(),
    company: form.company.value.trim() || '클래스로',
    experience,
    posting,
  };
  $('start-screen').hidden = true;
  $('interview-screen').hidden = false;
  renderStatus();
  setWaiting('질문을 준비하고 있어요…');

  try {
    let rows;
    try {
      const res = await fetch('data/questions.csv');
      if (!res.ok) throw new Error();
      rows = parseCsv(await res.text());
    } catch {
      throw new Error('질문 은행(questions.csv)을 불러오지 못했어요. 새로고침해 주세요.');
    }

    let passed = [];
    try {
      const { track, company } = state.profile;
      const made = await ask('make_questions', { track, company, experience });
      passed = checkGenerated(made.questions, made.allowedBasis);
    } catch (err) {
      if (session === state.session) $('chat-notice').textContent = `AI 출제에 실패해 질문 은행으로 대신해요. (${err.message})`;
    }
    if (session !== state.session) return;

    state.questions = [pickIntro(rows), ...fillMissing(passed, rows)]
      .map((q) => ({ ...q, turns: [], followUps: 0 }));
    state.index = 0;
    const source = state.profile.posting ? '입력한 공고' : '기본 공고 요약';
    bubble('system', `${state.profile.name} 님, ${state.profile.company} ${state.profile.trackLabel} 개발 면접을 시작할게요. (출제 기준: ${source})`);
    showQuestion();
  } catch (err) {
    if (session === state.session) $('chat-notice').textContent = err.message;
  } finally {
    if (session === state.session) { state.busy = false; setWaiting(null); }
  }
}

async function sendAnswer(event) {
  event.preventDefault();
  if (state.busy || state.finished || !state.questions.length) return;
  const input = $('answer');
  const text = input.value.trim();
  const notice = $('chat-notice');
  if (!text) { notice.textContent = '답변을 적어 주세요.'; return; }
  if (text.length > MAX_ANSWER) { notice.textContent = `답변은 ${MAX_ANSWER}자 이내로 적어 주세요. (지금 ${text.length}자)`; return; }
  notice.textContent = '';

  const q = state.questions[state.index];
  const session = state.session;
  q.turns.push({ role: 'candidate', text });
  const mine = bubble('candidate', text);
  input.value = '';
  state.busy = true;
  setWaiting('면접관이 답을 듣고 있어요…');

  try {
    const { track, company, experience } = state.profile;
    const res = await ask('interviewer', {
      track, company, experience,
      question: q.question,
      point: q.point,
      can_follow_up: q.followUps < MAX_FOLLOW_UPS ? '예' : '아니오',
      turns: q.turns,
    });
    if (session !== state.session) return;
    state.understanding.push(clamp(res.understanding, 0, 100));
    const reply = String(res.reply ?? '').trim();

    if (res.follow_up === true && q.followUps < MAX_FOLLOW_UPS) {
      q.followUps += 1;
      q.turns.push({ role: 'interviewer', text: reply });
      bubble('interviewer', reply, '꼬리 질문');
      renderStatus();
    } else if (res.follow_up === true) {
      nextQuestion(); // 꼬리 질문을 이미 했으므로 AI가 더 물어도 넘어간다
    } else {
      // 반응은 turns 에 넣지 않는다 (평가에는 질문 · 꼬리 질문 · 답만 보낸다)
      q.reaction = reply;
      if (reply) bubble('interviewer', reply);
      nextQuestion();
    }
  } catch (err) {
    if (session !== state.session) return;
    // 실패한 답은 기록에서 빼고 입력칸에 돌려놓아 다시 보낼 수 있게
    q.turns.pop();
    mine.remove();
    input.value = text;
    notice.textContent = err.message;
  } finally {
    if (session === state.session) { state.busy = false; setWaiting(null); }
  }
}

function restart() {
  const session = state.session + 1;
  Object.assign(state, newState(), { session });
  $('chat').replaceChildren();
  $('chat-notice').textContent = '';
  $('answer').value = '';
  setWaiting(null);
  $('eval-waiting').hidden = true;
  $('eval-results').replaceChildren();
  $('retry-answer').value = '';
  $('retry-notice').textContent = '';
  $('retry-waiting').hidden = true;
  $('refine-answer').value = '';
  $('refine-notice').textContent = '';
  $('refine-waiting').hidden = true;
  $('refine-result').replaceChildren();
  renderRetry();
  $('answer-form').hidden = false;
  $('eval-screen').hidden = true;
  $('interview-screen').hidden = true;
  $('start-screen').hidden = false;
}

// ---- 평가 ----

const EVAL_COUNT = TOTAL_QUESTIONS + 1;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function evalRequest(i) {
  const { track, company, experience } = state.profile;
  if (i === 0) {
    return ['eval_panel', { track, company, experience, turns: state.questions.flatMap((q) => q.turns) }];
  }
  const q = state.questions[i - 1];
  // 질문은 vars 로 가므로 contents 에는 본 답 + 꼬리 질문과 답만
  return ['eval_answer', { track, company, experience, question: q.question, point: q.point, turns: q.turns.slice(1) }];
}

// 무료 한도 때문에 한 번에 하나씩 차례로 부른다
async function runEvaluation(indices) {
  if (state.busy) return;
  state.busy = true;
  const session = state.session;
  $('eval-start').hidden = true;
  try {
    for (const i of indices) {
      $('eval-waiting').hidden = false;
      $('eval-waiting').textContent = `평가 중 ${i + 1}/${EVAL_COUNT}`;
      let result;
      try {
        result = { data: await ask(...evalRequest(i)) };
      } catch (err) {
        result = { error: err.message };
      }
      if (session !== state.session) return;
      state.evaluation[i] = result;
      renderEvaluation();
    }
  } finally {
    if (session === state.session) {
      state.busy = false;
      $('eval-waiting').hidden = true;
    }
  }
}

function errorRow(i, message) {
  const row = el('div', undefined, 'error-row');
  row.append(el('span', message));
  const button = el('button', '다시 시도');
  button.type = 'button';
  button.addEventListener('click', () => runEvaluation([i]));
  row.append(button);
  return row;
}

function renderPanel(item) {
  const box = el('div', undefined, 'card');
  box.append(el('h3', '위원 4명 평가'));
  if (!item) { box.append(el('p', '아직 평가 전이에요.', 'muted')); return box; }
  if (item.error) { box.append(errorRow(0, item.error)); return box; }

  const { panel, conflict, agree, next } = item.data;
  const avg = panelAverage(panel);
  box.append(el('p', `위원 평균 ${avg ?? '-'} / 10`, 'big'));

  const table = el('table');
  const head = table.createTHead().insertRow();
  for (const h of ['위원', '뽑지 말아야 할 이유', '좋은 점', '점수']) head.append(el('th', h));
  const body = table.createTBody();
  for (const p of panel ?? []) {
    const row = body.insertRow();
    row.append(el('td', p.role), el('td', p.against), el('td', p.good), el('td', `${clamp(p.score, 0, 10)}`, 'num'));
  }
  const wrap = el('div', undefined, 'table-wrap');
  wrap.append(table);
  box.append(wrap);

  box.append(el('h3', '판단이 갈린 곳'), el('p', conflict));
  box.append(el('h3', '모두 같은 판단'), el('p', agree));
  box.append(el('h3', '다음 연습에서 고칠 것'));
  const ol = el('ol');
  for (const n of next ?? []) ol.append(el('li', n));
  box.append(ol);
  return box;
}

function renderAnswer(i) {
  const q = state.questions[i - 1];
  const item = state.evaluation[i];
  const details = el('details');
  const total = item?.data ? answerTotal(item.data) : null;
  const score = item?.data ? `${total} / 20` : item?.error ? '평가 실패' : '평가 전';
  details.append(el('summary', `질문 ${i} · ${q.type} (${q.source}) — ${score}`));
  details.append(el('p', q.question));
  details.append(el('p', `내 답: ${q.turns.filter((t) => t.role === 'candidate').map((t) => t.text).join(' / ')}`, 'muted'));

  if (item?.error) {
    details.open = true;
    details.append(errorRow(i, item.error));
    return details;
  }
  if (!item) return details;

  const r = item.data;
  const table = el('table');
  const body = table.createTBody();
  for (const [key, label] of CRITERIA) {
    const row = body.insertRow();
    row.append(el('th', label), el('td', `${clamp(r[key], 0, 5)} / 5`, 'num'));
  }
  details.append(table);
  details.append(el('p', `가장 약한 점: ${r.weak}`));

  if (total < REWRITE_BELOW) {
    details.append(el('h3', '고친 답'), el('p', r.rewrite, 'rewrite'));
    if (r.check?.length) {
      details.append(el('h3', '사람이 확인할 것'));
      const ul = el('ul');
      for (const c of r.check) ul.append(el('li', c));
      details.append(ul);
    }
  }
  return details;
}

function renderEvaluation() {
  const results = $('eval-results');
  results.replaceChildren();
  $('eval-start').hidden = state.evaluation.some(Boolean);
  results.append(renderPanel(state.evaluation[0]));
  results.append(el('h3', '답변별 평가'));
  for (let i = 1; i < EVAL_COUNT; i++) results.append(renderAnswer(i));
  renderRetry();
}

// ---- 재도전 ----

function downloadReport() {
  const blob = new Blob([buildReport(state)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = '면접리포트.md';
  a.click();
  URL.revokeObjectURL(url);
}

function renderRetry() {
  $('report-download').hidden = !state.evaluation.some((e) => e?.data);
  const done = [];
  for (let i = 1; i < EVAL_COUNT; i++) if (state.evaluation[i]?.data) done.push(i);
  $('retry-box').hidden = !done.length;
  if (!done.length) return;
  done.sort((a, b) => answerTotal(state.evaluation[a].data) - answerTotal(state.evaluation[b].data));

  const pick = $('retry-pick');
  const selected = pick.value;
  pick.replaceChildren(...done.map((i) => {
    const option = el('option', `질문 ${i} · ${answerTotal(state.evaluation[i].data)}/20 — ${state.questions[i - 1].question}`);
    option.value = String(i);
    return option;
  }));
  if (done.includes(Number(selected))) pick.value = selected;
  renderRetryDetail();
}

function renderRetryDetail() {
  const i = Number($('retry-pick').value);
  const before = state.evaluation[i].data;
  $('retry-info').textContent = `지난 점수 ${answerTotal(before)} / 20 · 약한 점: ${before.weak}`;

  const box = $('retry-result');
  box.replaceChildren();
  const retry = state.retries[i];
  if (!retry) return;
  const c = compare(before, retry.data);
  box.append(el('p', `다시 채점 ${c.after} / 20 (${c.diffText})`, `big ${c.diff > 0 ? 'up' : c.diff < 0 ? 'down' : ''}`));
  const table = el('table');
  const head = table.createTHead().insertRow();
  for (const h of ['기준', '전', '후']) head.append(el('th', h));
  const body = table.createTBody();
  for (const r of c.rows) {
    const row = body.insertRow();
    row.append(el('td', r.label), el('td', `${r.before}`, 'num'), el('td', `${r.after}`, 'num'));
  }
  const total = body.insertRow();
  total.append(el('th', '합계'), el('td', `${c.before}`, 'num'), el('td', `${c.after}`, 'num'));
  box.append(table, el('p', `이번 약한 점: ${retry.data.weak}`));
}

async function submitRetry() {
  if (state.busy) return;
  const i = Number($('retry-pick').value);
  const answer = $('retry-answer').value.trim();
  const notice = $('retry-notice');
  if (!answer) { notice.textContent = '다시 쓴 답을 적어 주세요.'; return; }
  if (answer.length > MAX_ANSWER) { notice.textContent = `답변은 ${MAX_ANSWER}자 이내로 적어 주세요. (지금 ${answer.length}자)`; return; }
  notice.textContent = '';

  const q = state.questions[i - 1];
  const session = state.session;
  state.busy = true;
  $('retry-waiting').hidden = false;
  $('retry-waiting').textContent = '다시 채점하고 있어요…';
  try {
    const { track, company, experience } = state.profile;
    const data = await ask('retry', { track, company, experience, question: q.question, point: q.point, answer });
    if (session !== state.session) return;
    state.retries[i] = { answer, data };
    renderRetryDetail();
  } catch (err) {
    if (session === state.session) notice.textContent = err.message;
  } finally {
    if (session === state.session) { state.busy = false; $('retry-waiting').hidden = true; }
  }
}

// ---- 회사 공고 ----

const postingArea = (field) => document.querySelector(`textarea[data-posting="${field}"]`);
const postingTexts = () => Object.fromEntries(POSTING_FIELDS.map((f) => [f, postingArea(f).value]));

async function summarizePosting() {
  if (state.busy) return;
  const notice = $('posting-notice');
  const checked = document.querySelector('input[name="track"]:checked');
  const text = $('posting-text').value.trim();
  if (!checked) { notice.textContent = '트랙을 먼저 골라 주세요.'; return; }
  if (!text) { notice.textContent = '공고 원문을 붙여 넣어 주세요.'; return; }
  if (text.length > 5000) { notice.textContent = `공고 원문은 5000자 이내로 붙여 넣어 주세요. (지금 ${text.length}자)`; return; }
  notice.textContent = '';

  state.busy = true;
  $('posting-waiting').hidden = false;
  $('posting-waiting').textContent = '공고를 키워드로 정리하고 있어요…';
  try {
    const data = await ask('summarize_posting', { track: checked.value, posting_text: text });
    for (const f of POSTING_FIELDS) postingArea(f).value = (data[f] ?? []).join('\n');
  } catch (err) {
    notice.textContent = err.message;
  } finally {
    state.busy = false;
    $('posting-waiting').hidden = true;
  }
}

// ---- 마지막 질문 다듬기 ----

async function submitRefine() {
  if (state.busy) return;
  const answer = $('refine-answer').value.trim();
  const notice = $('refine-notice');
  if (!answer) { notice.textContent = '면접관에게 할 질문을 적어 주세요.'; return; }
  if (answer.length > MAX_ANSWER) { notice.textContent = `질문은 ${MAX_ANSWER}자 이내로 적어 주세요. (지금 ${answer.length}자)`; return; }
  notice.textContent = '';

  const session = state.session;
  state.busy = true;
  $('refine-waiting').hidden = false;
  $('refine-waiting').textContent = '질문을 다듬고 있어요…';
  try {
    const { track, company, experience } = state.profile;
    const data = await ask('refine_question', { track, company, experience, answer });
    if (session !== state.session) return;
    const box = $('refine-result');
    box.replaceChildren();
    const ol = el('ol');
    for (const q of data.questions ?? []) ol.append(el('li', q));
    box.append(ol, el('p', `원래 질문에서 빠진 것: ${data.why}`, 'muted'));
  } catch (err) {
    if (session === state.session) notice.textContent = err.message;
  } finally {
    if (session === state.session) { state.busy = false; $('refine-waiting').hidden = true; }
  }
}

$('start-form').addEventListener('submit', startInterview);
$('answer-form').addEventListener('submit', sendAnswer);
$('restart').addEventListener('click', restart);
$('eval-start').addEventListener('click', () => runEvaluation([...Array(EVAL_COUNT).keys()]));
$('retry-pick').addEventListener('change', () => {
  $('retry-answer').value = state.retries[$('retry-pick').value]?.answer ?? '';
  $('retry-notice').textContent = '';
  renderRetryDetail();
});
$('retry-submit').addEventListener('click', submitRetry);
$('report-download').addEventListener('click', downloadReport);
$('refine-submit').addEventListener('click', submitRefine);
$('posting-summarize').addEventListener('click', summarizePosting);
