// 에이전트 상세 패널: 캐릭터나 세션 카드를 누르면 열린다.
// 열려 있는 동안 에이전트 목록이 바뀔 때마다 서버에 다시 물어본다 (socket 'agentDetail').
// 🔒 서버는 도구 이름·상태·시각·횟수만 보낸다 (server/agents/session.js toPublicDetail).
import { state, agents } from '../state.js';
import { canvas } from '../canvas.js';
import { stateInfo, stateLabel, KIND_CHIP, titleFor } from '../display.js';
import { esc, ago, hhmm, hhmmss } from '../util.js';
import { stopInput } from '../players.js';

const detail = { id: null, data: null, gone: false, pending: false };
let panelEl;

export function initDetailPanel() {
  panelEl = document.getElementById('detail');
  // 바깥 어두운 곳이나 ✕를 누르면 닫힘
  panelEl.addEventListener('click', (e) => { if (e.target === panelEl || e.target.closest('#dt-close')) closeDetail(); });
}

export const isDetailOpen = () => !!panelEl && !panelEl.hidden;

export function openDetail(id) {
  if (detail.id !== id) { // 서버 답을 기다리는 동안은 목록에 있던 정보로 먼저 보여 준다
    const known = agents.get(id)?.data;
    detail.data = known ? { ...known } : null;
    detail.gone = false;
  }
  detail.id = id;
  panelEl.hidden = false;
  stopInput();
  render(); fetchDetail();
  document.getElementById('dt-close')?.focus({ preventScroll: true });
}

export function closeDetail() {
  detail.id = null; panelEl.hidden = true;
  canvas.focus({ preventScroll: true });
}

/** 에이전트 목록이 바뀌었을 때: 열려 있으면 새로 받아 온다 */
export function refreshDetail() {
  if (detail.id) fetchDetail();
}

/** 몇 초마다: 'n초 전' 같은 시간 표시만 새로 그린다 */
export function refreshDetailTimes() {
  if (detail.id) render();
}

function fetchDetail() {
  const { socket } = state;
  if (!detail.id || !socket || detail.pending) return;
  const id = detail.id;
  detail.pending = true;
  socket.timeout(4000).emit('agentDetail', id, (err, res) => {
    detail.pending = false;
    if (err || detail.id !== id) return;
    if (res) { detail.data = res; detail.gone = false; } else detail.gone = true; // 사무실을 떠남: 마지막 내용 유지
    render();
  });
}

function render() {
  const d = detail.data, body = document.getElementById('dt-body');
  if (!d) { body.innerHTML = '<div class="empty">불러오는 중…</div>'; return; }
  const a = agents.get(d.id);
  const chip = KIND_CHIP[d.agent] || KIND_CHIP.claude, band = a?.band || chip.bg;
  const section = (title, html) => `<section class="dt-sec"><h3>${title}</h3>${html}</section>`;

  let html = `<div class="dt-head">
      <span class="who ${d.agent}" style="background:${band}">${chip.label}</span>
      <h2 id="dt-title" title="${esc(d.title)}">${d.isSub ? '↳ ' : ''}${esc(d.title)}</h2>
      <button class="btn ghost" id="dt-close" type="button" aria-label="닫기">✕</button></div>
    <div class="dt-state" style="--c:${stateInfo(d.state).color}"><b>● ${esc(stateLabel(d))}</b> <span>${esc(d.detail || '')}</span></div>
    <div class="dt-meta">${[d.project && `📁 ${esc(d.project)}`, `${titleFor(d)} · 도구 ${d.tools}회`,
      d.startedAt && `시작 ${hhmm(d.startedAt)}`, d.lastEvent && `마지막 활동 ${ago(d.lastEvent)}`].filter(Boolean).join('<span>·</span>')}</div>`;

  if (detail.gone) html += '<div class="dt-note">이 세션은 최근 30분간 활동이 없어 사무실을 떠났어요. 마지막으로 본 내용이에요.</div>';
  if (d.state === 'waiting') {
    html += d.waitExact
      ? '<div class="dt-note warn">❗ 승인을 기다리고 있어요. 에이전트 화면에서 허용하거나 거절해 주세요.</div>'
      : `<div class="dt-note warn">45초 넘게 응답이 없어 승인 대기로 <b>추정</b>했어요. 오래 걸리는 명령일 수도 있어요.
          ${d.agent === 'claude' ? '<br>Claude Code 훅을 연결하면 정확해져요 → <code>npm run hook-config</code>' : ''}</div>`;
  }

  // 하는 일 분포 (상태별 도구 횟수)
  const counts = Object.entries(d.byState || {}).filter(([, n]) => n).sort((p, q) => q[1] - p[1]);
  if (counts.length) {
    html += section('하는 일 <small>읽은 기록 기준</small>',
      `<div class="dt-bar">${counts.map(([st, n]) => `<i style="flex:${n};background:${stateInfo(st).color}" title="${stateInfo(st).label} ${n}회"></i>`).join('')}</div>
      <div class="dt-legend">${counts.map(([st, n]) => `<span><i style="background:${stateInfo(st).color}"></i>${stateInfo(st).label} ${n}</span>`).join('')}</div>`);
  }
  html += '<div class="dt-note">🔒 보안을 위해 명령어·파일 이름·요청 글은 표시하지 않아요. 도구 이름과 시각만 보여요.</div>';

  // 타임라인 (최근 것부터). 서버 답이 오기 전에는 목록 카드의 짧은 기록으로
  const timeline = d.history?.length ? d.history : (d.log || []).slice().reverse();
  if (timeline.length) {
    html += section('타임라인', `<ol class="dt-log">${timeline.map((h) => `<li><time>${hhmmss(h.t)}</time><span>${esc(h.text)}</span></li>`).join('')}</ol>`);
  }

  // 다시 그려도 스크롤 위치와 닫기 버튼 포커스는 유지
  const scroll = body.scrollTop, focused = document.activeElement?.id === 'dt-close';
  body.innerHTML = html;
  body.scrollTop = scroll;
  if (focused) document.getElementById('dt-close').focus({ preventScroll: true });
}
