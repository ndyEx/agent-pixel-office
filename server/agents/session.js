// 에이전트 세션 한 개의 상태, 그리고 그 상태를 브라우저로 보낼 모양으로 바꾸는 함수.
//
// 🔒 보안 경계: 브라우저로 나가는 데이터는 이 파일의 toPublic()/toPublicDetail()만 만든다.
//    이 페이지는 외부에 공개될 수 있고 누구나 가입할 수 있으므로, 여기서는 도구 이름·상태·시각·횟수만 내보낸다.
//    파일 경로가 든 내부 id(s.id)도 내보내지 않고 해시값(publicId)으로 바꿔 보낸다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_MAX = 6;        // 목록 카드에 보여 줄 최근 일
const HISTORY_MAX = 60;   // 상세 패널 타임라인 길이
const WAIT_GUESS_MS = 45_000;   // 훅이 없는 Claude: 도구 호출 뒤 이만큼 조용하면 승인 대기로 추정
const THINK_IDLE_MS = 120_000;  // '생각 중'이 이만큼 이어지면 휴식으로 표시

/**
 * @param {string} file  세션 기록 파일 경로 (Claude: ~/.claude/projects/…, Codex: ~/.codex/sessions/…)
 * @param {'claude'|'codex'} agent
 */
function createSession(file, agent) {
  const isSub = file.includes(`${path.sep}subagents${path.sep}`);
  const project = agent === 'codex' ? '' : path.basename(path.dirname(isSub ? path.dirname(path.dirname(file)) : file));
  return {
    id: file,                     // 내부용: 기록 파일 경로
    publicId: crypto.createHash('sha256').update(file).digest('hex').slice(0, 16), // 화면용 id
    ownId: path.basename(file, '.jsonl'),
    agent,
    title: isSub ? 'subagent' : agent === 'codex' ? 'Codex' : path.basename(file, '.jsonl').slice(0, 8),
    project: project.replace(/^-Users-[^-]+-/, '').slice(-32),
    isSub,
    state: 'idle',                // typing | reading | terminal | browsing | meeting | working | thinking | waiting | idle
    detail: '',                   // 상태 옆에 붙는 한 줄 (도구 이름 등)
    lastEvent: 0,                 // 마지막 활동 시각 (ms)
    tools: 0,                     // 도구 사용 횟수 (칭호 계산용)
    log: [],                      // 목록 카드용: 서버가 지켜보는 동안 생긴 일
    history: [],                  // 상세 패널용: 기록에 남은 시각 기준 (처음 읽은 끝부분 포함)
    byState: {},                  // 상태별 도구 횟수 (읽은 범위 기준)
    cwd: '',
    startedAt: (() => { try { return fs.statSync(file).birthtimeMs || 0; } catch { return 0; } })(),
    // 파일 이어 읽기
    offset: 0,
    partial: '',
    // Claude Code 훅 (agents/hooks.js)
    hooked: false,                // 훅 이벤트를 받은 적 있나 (있으면 침묵 추정을 끈다)
    hookWait: false,              // 훅이 알려 준 승인 대기 중
    waitDetail: '',
    // Codex: 다른 에이전트 대화를 가져온 턴을 읽는 중 (agents/codex-log.js)
    importing: false,
  };
}

// 일어난 일 한 줄 기록. live=false는 서버가 처음 켜질 때 지난 기록을 읽는 경우 (목록 카드에는 안 남김)
function pushLog(s, text, ts = Date.now(), live = true) {
  s.history.push({ t: ts, text });
  if (s.history.length > HISTORY_MAX) s.history.shift();
  if (!live) return;
  s.log.push({ t: Date.now(), text });
  if (s.log.length > LOG_MAX) s.log.shift();
}

// 지금 보여 줄 상태: 기록에 남지 않는 '승인 대기'와 '오래 생각 중'을 침묵 시간으로 보정한다
function displayState(s, now) {
  const quiet = now - s.lastEvent;
  if (s.agent === 'claude' && !s.hooked && s.state !== 'idle' && s.state !== 'thinking' && quiet > WAIT_GUESS_MS) return 'waiting';
  if (s.state === 'thinking' && quiet > THINK_IDLE_MS) return 'idle';
  return s.state;
}

/** 목록·캐릭터용 공개 데이터 */
function toPublic(s, title, now = Date.now()) {
  const state = displayState(s, now);
  return {
    id: s.publicId, agent: s.agent, title, project: s.project, isSub: s.isSub,
    state, detail: s.detail, lastEvent: s.lastEvent, tools: s.tools, log: s.log,
    waitExact: state === 'waiting' && (s.agent === 'codex' || s.hookWait), // 확실한 대기인가(추정이 아닌가)
    hooked: s.hooked,
  };
}

/** 상세 패널용 공개 데이터 */
function toPublicDetail(s, title) {
  return { ...toPublic(s, title), startedAt: s.startedAt, byState: s.byState, history: s.history.slice().reverse() };
}

module.exports = { createSession, pushLog, toPublic, toPublicDetail };
