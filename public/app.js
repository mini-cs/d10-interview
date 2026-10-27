import {
  TOTAL_QUESTIONS, MAX_FOLLOW_UPS, parseCsv, pickIntro, checkGenerated, fillMissing,
  clamp, averageUnderstanding,
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
  };
}

async function ask(task, vars) {
  let res;
  try {
    res = await fetch('/.netlify/functions/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, vars }),
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
  notice.textContent = '';

  state.busy = true;
  const session = state.session;
  state.profile = {
    name: form.name.value.trim() || '지원자',
    track: checked.value,
    trackLabel: checked.parentElement.textContent.trim(),
    company: form.company.value.trim() || '클래스로',
    experience,
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
    bubble('system', `${state.profile.name} 님, ${state.profile.company} ${state.profile.trackLabel} 개발 면접을 시작할게요.`);
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
      if (reply) {
        q.turns.push({ role: 'interviewer', text: reply });
        bubble('interviewer', reply);
      }
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
  $('interview-screen').hidden = true;
  $('start-screen').hidden = false;
}

$('start-form').addEventListener('submit', startInterview);
$('answer-form').addEventListener('submit', sendAnswer);
$('restart').addEventListener('click', restart);
