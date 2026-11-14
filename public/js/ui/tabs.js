// 방 탭 (사무실 · 라운지 · 회의실): 방마다 사람·에이전트 수와 안 읽은 채팅 수.
// 로그인 전에는 구경할 방을 고르고, 로그인 후에는 그 방으로 바로 이동한다.
import { state, agents, people, unread } from '../state.js';
import { ROOMS, SPAWN } from '../world.js';
import { canvas } from '../canvas.js';
import { enterRoom } from '../players.js';
import { renderChat } from './chat.js';

export function initTabs() {
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]');
    if (!b || b.dataset.room === state.viewRoom) return;
    const id = b.dataset.room;
    if (state.me && state.me.placed) enterRoom(id, SPAWN[id].x, SPAWN[id].y);
    else { state.viewRoom = id; unread[id] = 0; renderTabs(); renderChat(); }
    canvas.focus();
  });
}

export function renderTabs() {
  document.getElementById('tabs').innerHTML = ROOMS.map((r) => {
    const humans = [...people.values()].filter((p) => p.room === r.id).length;
    const bots = r.id === 'office' ? agents.size : 0;
    const count = [humans && `👤${humans}`, bots && `🤖${bots}`].filter(Boolean).join(' ');
    return `<button class="tab${r.id === state.viewRoom ? ' on' : ''}" data-room="${r.id}">${r.name}
      ${count ? `<small>${count}</small>` : ''}${unread[r.id] ? `<b class="unread">${unread[r.id]}</b>` : ''}</button>`;
  }).join('');
}
