// 사람 캐릭터: 내 캐릭터 이동(방향키·터치 조이스틱), 자리에 앉기, 방 이동, 다른 사람 위치 맞추기.
// 내 위치는 서버로 보내고(move), 다른 사람 위치는 서버가 0.1초마다 보내 준다(players).
import { state, people, unread } from './state.js';
import { ROOMS, ROOM_BY_ID, DOOR_Y0, DOOR_Y1, SPAWN, ACT_SPOTS, blocked, inZone, dirFrom } from './world.js';
import { lookFor } from './looks.js';
import { agentUsesSpot } from './agents.js';
import { renderTabs } from './ui/tabs.js';
import { renderChat, visibleChatInput } from './ui/chat.js';
import { isDetailOpen, closeDetail } from './ui/detail-panel.js';

const MY_SPEED = 60;          // 월드 칸/초
const OTHERS_SPEED = 90;      // 다른 사람이 서버 위치를 따라가는 속도
const SIT_DELAY = 0.35;       // 자리에서 이만큼(초) 멈추면 자동으로 앉거나 마신다
const SEND_GAP_MS = 50;       // 위치는 최대 초당 20번 보낸다

const KEYMAP = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const keys = new Set();                       // 눌려 있는 방향키
const joy = { x: 0, y: 0, pointer: null };    // 조이스틱 기울기 (-1~1)
let joyEl, joyKnob;
let lastMoveSent = 0, dirtyMove = false;      // 보내지 않은 이동이 있나

export const isTouch = () => navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;

export function initPlayers() {
  const typingInField = (e) => /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  addEventListener('keydown', (e) => {
    if (isDetailOpen()) { if (e.key === 'Escape') closeDetail(); return; } // 상세 패널이 열려 있으면 이동·채팅 단축키는 쉰다
    if (typingInField(e)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (KEYMAP[e.key] && state.me) { keys.add(e.key); e.preventDefault(); }
    // Enter: 지금 화면에 보이는 채팅 입력칸으로 (좁은 화면이면 사무실 화면 바로 아래 입력칸), 페이지는 스크롤하지 않음
    if (e.key === 'Enter' && state.me) { visibleChatInput().focus({ preventScroll: true }); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.key));
  addEventListener('blur', stopInput);

  document.body.classList.toggle('touch', isTouch());
  initJoystick();
}

/** 눌린 키·조이스틱을 모두 놓은 상태로 (창을 떠나거나 패널을 열 때) */
export function stopInput() {
  keys.clear();
  resetJoy();
}

// ---------- 터치 조이스틱 ----------
// 손가락을 중심에서 끄는 거리(0~1)만큼 속도가 붙는 아날로그 방식
function initJoystick() {
  joyEl = document.getElementById('joystick');
  joyKnob = document.getElementById('joy-knob');
  joyEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    joy.pointer = e.pointerId;
    // 손가락이 원 밖으로 나가도 계속 따라가게. 일부 브라우저는 실패할 수 있어 무시
    try { joyEl.setPointerCapture(e.pointerId); } catch { /* 캡처 없이도 동작 */ }
    joyEl.classList.add('active');
    updateJoy(e);
  });
  joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joy.pointer) updateJoy(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
    joyEl.addEventListener(ev, (e) => { if (e.pointerId === joy.pointer) resetJoy(); });
}

function updateJoy(e) {
  const r = joyEl.getBoundingClientRect();
  const radius = r.width / 2;
  let dx = e.clientX - (r.left + radius), dy = e.clientY - (r.top + radius);
  const dist = Math.hypot(dx, dy);
  if (dist > radius) { dx *= radius / dist; dy *= radius / dist; }
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  const mag = Math.min(1, dist / radius);
  // 가운데 15%는 무시해서 살짝 닿아도 움직이지 않게
  if (mag < 0.15) { joy.x = joy.y = 0; return; }
  joy.x = dx / radius; joy.y = dy / radius;
}

function resetJoy() {
  joy.x = joy.y = 0; joy.pointer = null;
  if (!joyKnob) return;
  joyKnob.style.transform = ''; joyEl.classList.remove('active');
}

/** 로그인한 터치 기기에서만 조이스틱을 보인다 */
export function setJoystickVisible(visible) {
  joyEl.hidden = !visible;
  if (!visible) resetJoy();
}

// ---------- 내 캐릭터 ----------
/** 매 프레임: 입력에 따라 내 캐릭터를 움직이고, 바뀐 위치를 서버로 보낸다 */
export function moveMe(dt) {
  moveMyCharacter(dt);
  sendMove(false);
}

function moveMyCharacter(dt) {
  const me = state.me;
  if (!me || !me.placed) return;
  let vx = 0, vy = 0;
  for (const k of keys) { vx += KEYMAP[k][0]; vy += KEYMAP[k][1]; }
  let power = 1;
  if (!vx && !vy && (joy.x || joy.y)) { vx = joy.x; vy = joy.y; power = Math.min(1, Math.hypot(vx, vy)); }
  me.moving = !!(vx || vy);
  if (!me.moving) {
    // 상호작용 자리에서 잠깐 멈추면 자동으로 앉거나 마시기 시작
    me.still = (me.still || 0) + dt;
    if (!me.act && me.still > SIT_DELAY) startAct();
    return;
  }
  me.still = 0;
  if (me.act) { // 움직이면 행동을 그만두고 원래 서 있던 자리에서 출발
    me.x = me.act.sx ?? me.x; me.y = me.act.sy ?? me.y; me.act = null;
  }
  // 어떤 이유로든 가구 안에 서 있으면(앉은 정보만 사라진 경우 등) 가장 가까운 빈자리로 빠져나온다
  if (blocked(me.room, me.x, me.y)) unstick();
  me.dir = dirFrom(vx, vy);
  const len = Math.hypot(vx, vy), sp = MY_SPEED * dt * power;
  const nx = me.x + (vx / len) * sp, ny = me.y + (vy / len) * sp;
  const idx = ROOM_BY_ID[me.room].index;
  const inDoor = ny > DOOR_Y0 + 2 && ny < DOOR_Y1 - 2;
  // 벽(blocked)이 x 5~235에서 막으므로 문 판정은 그 경계에서 한다
  if (nx >= 235 && inDoor && ROOMS[idx + 1]) return enterRoom(ROOMS[idx + 1].id, 10, ny);
  if (nx <= 5 && inDoor && ROOMS[idx - 1]) return enterRoom(ROOMS[idx - 1].id, 230, ny);
  if (!blocked(me.room, nx, me.y)) me.x = nx;  // 가로·세로를 따로 막아서 벽을 따라 미끄러지게
  if (!blocked(me.room, me.x, ny)) me.y = ny;
  dirtyMove = true;
}

// 막힌 곳에 있으면 주변을 동심원으로 넓혀 가며 가장 가까운 빈자리를 찾는다
function unstick() {
  const me = state.me;
  for (let r = 1; r <= 60; r++) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const x = me.x + Math.cos(ang) * r, y = me.y + Math.sin(ang) * r;
      if (!blocked(me.room, x, y)) { me.x = x; me.y = y; dirtyMove = true; return true; }
    }
  }
  const s = SPAWN[me.room]; me.x = s.x; me.y = s.y; dirtyMove = true; // 그래도 없으면 방 입구로
  return false;
}

// 그 자리를 이미 누가 쓰고 있나 (에이전트가 앉은 책상·소파, 다른 사람이 앉은 의자)
function spotTaken(id) {
  const me = state.me;
  for (const p of people.values()) if (p.name !== me.name && p.room === me.room && p.act?.id === id) return true;
  return me.room === 'office' && agentUsesSpot(id);
}

function startAct() {
  const me = state.me;
  // 여러 자리가 한 구역을 같이 쓰면(휴게실 소파) 가장 가까운 빈자리를 고른다
  const dist = (s) => (s.to ? Math.hypot(s.to.x - me.x, s.to.y - me.y) : 0);
  const spot = (ACT_SPOTS[me.room] || [])
    .filter((s) => inZone(me.x, me.y, s.zone) && !spotTaken(s.id))
    .sort((p, q) => dist(p) - dist(q))[0];
  if (!spot) return;
  // sx, sy: 앉기 전 서 있던 자리 (일어날 때 여기로 돌아온다)
  me.act = { id: spot.id, a: spot.a || null, p: spot.p || 'stand', d: spot.d, c: !!spot.c, sx: me.x, sy: me.y };
  if (spot.to) { me.x = spot.to.x; me.y = spot.to.y; }
  me.dir = spot.d;
  sendMove(true);
}

/** 내가 다른 방으로 들어간다 (문을 지나거나 방 탭을 눌러서) */
export function enterRoom(room, x, y) {
  const me = state.me;
  me.act = null;
  me.room = room; me.x = x; me.y = y; state.viewRoom = room;
  unread[room] = 0;
  sendMove(true);
  renderTabs(); renderChat();
}

function sendMove(force) {
  const { me, socket } = state;
  const now = performance.now();
  if (!me || !socket || (!force && (!dirtyMove || now - lastMoveSent < SEND_GAP_MS))) return;
  lastMoveSent = now; dirtyMove = false;
  // sx, sy: 앉기 전 서 있던 자리 (다시 접속했을 때 가구 안에 갇히지 않도록 서버가 여기로 되돌림)
  const act = me.act && { id: me.act.id, a: me.act.a, p: me.act.p, d: me.act.d, c: me.act.c, sx: me.act.sx, sy: me.act.sy };
  socket.emit('move', { room: me.room, x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, act });
}

/** 보내지 않은 이동을 버린다 (다시 연결하거나 로그아웃할 때 서버 위치를 따르려고) */
export function discardPendingMove() {
  dirtyMove = false;
}

// ---------- 서버가 알려 준 위치 ----------
/** 서버의 'playerMoved' 이벤트: 내 다른 탭에서 움직였다. 이 탭도 서버 위치를 따른다 */
export function syncOwnPosition(s) {
  const me = state.me;
  if (!me || s.name !== me.name) return;
  Object.assign(me, { room: s.room, x: s.x, y: s.y, placed: true, moving: false,
    act: s.act ? { ...s.act, sx: s.act.sx ?? s.x, sy: s.act.sy ?? s.y } : null });
  if (s.act) me.dir = s.act.d;
  dirtyMove = false;
  stopInput();
  state.viewRoom = s.room; unread[s.room] = 0;
  renderChat(); renderTabs();
}

/** 서버의 'players' 이벤트: 접속한 사람 전체 */
export function syncPeople(list) {
  const me = state.me;
  const names = new Set(list.map((p) => p.name));
  for (const n of people.keys()) if (!names.has(n)) people.delete(n);
  for (const s of list) {
    let p = people.get(s.name);
    if (!p) { p = { name: s.name, x: s.x, y: s.y, look: lookFor(s.name) }; people.set(s.name, p); }
    if (p.room !== s.room) { p.x = s.x; p.y = s.y; } // 방을 옮기면 걸어오지 않고 바로 등장
    p.room = s.room; p.tx = s.x; p.ty = s.y; p.act = s.act || null;
    if (p.act) p.dir = p.act.d;
    if (me && s.name === me.name && !me.placed) syncOwnPosition(s); // 접속 직후: 서버가 기억한 내 자리에서 시작
  }
  renderTabs();
}

/** 매 프레임: 다른 사람은 서버 위치를 향해 부드럽게 따라간다 */
export function movePeople(dt) {
  for (const p of people.values()) {
    const dx = p.tx - p.x, dy = p.ty - p.y, dist = Math.hypot(dx, dy);
    p.moving = dist > 0.5;
    if (p.moving) { const sp = Math.min(dist, OTHERS_SPEED * dt); p.x += (dx / dist) * sp; p.y += (dy / dist) * sp; if (dist > 1) p.dir = dirFrom(dx, dy); }
  }
}
