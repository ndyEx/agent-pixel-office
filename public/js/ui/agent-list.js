// 사무실 화면 아래의 에이전트 세션 카드 목록. 카드를 누르면 상세 패널이 열린다.
import { state, agents } from '../state.js';
import { stateInfo, stateLabel, titleFor } from '../display.js';
import { esc, ago } from '../util.js';
import { openDetail, refreshDetailTimes } from './detail-panel.js';

const REFRESH_MS = 5000; // 'n초 전' 표시를 새로 고치는 간격

export function initAgentList() {
  document.getElementById('list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (card) openDetail(card.dataset.id);
  });
  setInterval(() => { renderAgentList(); refreshDetailTimes(); }, REFRESH_MS);
}

export function renderAgentList() {
  const el = document.getElementById('list');
  if (!state.sessions.length) { el.innerHTML = '<div class="card empty">활동 중인 에이전트 세션 없음</div>'; return; }
  el.innerHTML = state.sessions.map((s) => {
    const a = agents.get(s.id);
    return `<div class="card agent-card" data-id="${esc(s.id)}" title="클릭하면 자세히 보기">
      <div class="top"><span class="dot" style="background:${a?.band || a?.look.shirt}"></span>
        <span class="who ${s.agent}"${a?.band ? ` style="background:${a.band}"` : ''}>${s.agent === 'codex' ? 'Codex' : 'Claude'}</span>
        <span class="name" title="${esc(s.title)}">${s.isSub ? '↳ ' : ''}${esc(s.title)}</span>
        <span class="badge" style="color:${stateInfo(s.state).color}">${stateLabel(s)}</span></div>
      <div class="rank">${titleFor(s)}</div>
      <div class="detail">${esc(s.detail || '')}</div>
      <div class="detail">${esc(s.project)} · 도구 ${s.tools}회 · ${ago(s.lastEvent)}</div>
      ${s.log.length ? `<ul class="log">${s.log.slice().reverse().map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
}
