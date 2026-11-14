// 방별 채팅. 입력칸은 두 곳: 오른쪽(좁은 화면에서는 아래) 채팅창, 그리고 폰에서만 보이는 사무실 화면 바로 아래.
// 서버 이벤트: history(접속 때 전체), chat(새 메시지), chatCleared(초기화)
import { state, people, chats, unread } from '../state.js';
import { ROOMS, ROOM_BY_ID } from '../world.js';
import { esc, hhmm, flash } from '../util.js';
import { renderTabs } from './tabs.js';

const KEEP = 100; // 방마다 기억하는 메시지 수 (서버도 100개)

export function initChat() {
  for (const [formId, inputId] of [['chat-form', 'chat-input'], ['chat-form-m', 'chat-input-m']])
    document.getElementById(formId).addEventListener('submit', (e) => { e.preventDefault(); sendChat(document.getElementById(inputId)); });

  // 채팅 초기화: 지금 방의 기록을 모두의 화면과 서버에서 지운다 (되돌릴 수 없으니 먼저 확인)
  document.getElementById('chat-clear').addEventListener('click', () => {
    const { me, socket, viewRoom } = state;
    if (!me || !socket) return;
    if (!confirm(`${ROOM_BY_ID[viewRoom].name} 채팅 기록을 모두 지울까요?\n모든 사람의 화면에서 지워지고 되돌릴 수 없어요.`)) return;
    socket.timeout(5000).emit('clearChat', { room: viewRoom }, (err, res) => {
      if (err) return flash('초기화 시간 초과');
      if (res?.error) flash(res.error);
    });
  });
}

export function renderChat() {
  const { me, viewRoom } = state;
  document.getElementById('chat-title').textContent = `# ${ROOM_BY_ID[viewRoom].name} 채팅`;
  const box = document.getElementById('chat-log');
  const msgs = chats[viewRoom];
  // name이 빈 메시지는 서버가 남긴 알림(예: 채팅 초기화)
  box.innerHTML = msgs.length
    ? msgs.map((m) => (!m.name
      ? `<div class="msg sys"><span class="t">${hhmm(m.t)}</span> 📢 ${esc(m.text)}</div>`
      : `<div class="msg${me && m.name === me.name ? ' mine' : ''}"><span class="t">${hhmm(m.t)}</span> <b>${esc(m.name)}</b> ${esc(m.text)}</div>`)).join('')
    : '<div class="empty">아직 대화가 없어요</div>';
  box.scrollTop = box.scrollHeight;
  document.getElementById('chat-clear').hidden = !me;
  for (const id of ['chat-input', 'chat-input-m']) {
    const input = document.getElementById(id);
    input.disabled = !me;
    input.placeholder = me ? `${ROOM_BY_ID[viewRoom].name}에 메시지 보내기${id === 'chat-input' ? ' (Enter)' : ''}` : '로그인하면 채팅할 수 있어요';
  }
  // 폰: 사무실 화면 위에 최근 대화 3줄을 겹쳐 보여준다 (아래 채팅창까지 스크롤하지 않아도 되게)
  document.getElementById('chat-peek').innerHTML = msgs.slice(-3)
    .map((m) => (m.name ? `<div><b>${esc(m.name)}</b> ${esc(m.text)}</div>` : `<div>📢 ${esc(m.text)}</div>`)).join('');
}

/** 지금 화면에 보이는 채팅 입력칸 (Enter로 바로 입력하려고) */
export function visibleChatInput() {
  const m = document.getElementById('chat-input-m');
  return m.offsetParent ? m : document.getElementById('chat-input'); // display:none이면 offsetParent가 null
}

function sendChat(input) {
  const text = input.value.trim();
  const { me, socket, viewRoom } = state;
  if (!text || !me || !socket) return;
  // 서버가 저장·전송을 마치면 ack 콜백으로 결과를 알려준다
  socket.timeout(5000).emit('chat', { text, room: viewRoom }, (err, res) => {
    if (err) return flash('전송 시간 초과');
    if (res?.error) return flash(res.error);
    input.value = '';
  });
}

// ---------- 서버 이벤트 ----------
export function onHistory(h) {
  for (const r of ROOMS) chats[r.id] = h[r.id] || [];
  renderChat();
}

export function onChat(m) {
  chats[m.room].push(m); if (chats[m.room].length > KEEP) chats[m.room].shift();
  const p = people.get(m.name);
  if (p) { p.say = m.text; p.sayAt = Date.now(); } // 머리 위 말풍선
  if (m.room === state.viewRoom) renderChat();
  else { unread[m.room]++; renderTabs(); }
}

export function onChatCleared({ room, notice }) {
  chats[room] = notice ? [notice] : [];
  for (const p of people.values()) if (p.room === room) p.say = null; // 머리 위 말풍선도 지움
  if (room === state.viewRoom) renderChat();
}
