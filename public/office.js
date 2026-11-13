// Pixel Office 렌더러: 서버가 보내는 세션 상태를 픽셀 캐릭터로 그린다
// + 로그인한 사용자는 방향키로 자기 캐릭터를 움직이고, 방마다 따로 채팅한다
const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const S = 4; // 월드 1칸 = 화면 4px (월드 크기 240 x 150)

const STATE_INFO = {
  typing:   { label: '타이핑',   color: '#7bd88f' },
  reading:  { label: '자료 조사', color: '#f5c26b' },
  terminal: { label: '터미널',   color: '#ff9e64' },
  browsing: { label: '브라우징', color: '#7aa2f7' },
  meeting:  { label: '회의',     color: '#bb9af7' },
  working:  { label: '작업 중',  color: '#7dcfff' },
  thinking: { label: '생각 중',  color: '#c0caf5' },
  waiting:  { label: '대기(승인?)', color: '#ff5c7a' },
  idle:     { label: '휴식',     color: '#6b7089' },
};

// ---------- 방 ----------
// 방은 왼쪽→오른쪽으로 이어져 있고, 옆 벽의 문(DOOR_Y0~DOOR_Y1)으로 오간다
const ROOMS = [
  { id: 'office',  name: '사무실', floor: ['#3a3f5c', '#363a55'], wall: '#4a4e6e' },
  { id: 'lounge',  name: '라운지', floor: ['#5a4632', '#54412e'], wall: '#5b4a6e' },
  { id: 'meeting', name: '회의실', floor: ['#2f4a4a', '#2b4545'], wall: '#3e5a5e' },
];
const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r, i) => [r.id, { ...r, index: i }]));
const DOOR_Y0 = 72, DOOR_Y1 = 100;
const SPAWN = { office: { x: 180, y: 140 }, lounge: { x: 14, y: 86 }, meeting: { x: 14, y: 86 } };

// 사무실 배치
const DESKS = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) DESKS.push({ x: 56 + c * 36, y: 38 + r * 34 });
const SPOTS = {
  reading:  { x: 22, y: 56 },
  terminal: { x: 218, y: 56 },
  meeting:  { x: 120, y: 118 },
  idle:     { x: 30, y: 132 },
};

const SOFA_X = [28, 41, 54]; // 사무실 소파 좌석

// ---------- 상호작용 자리 ----------
// 내 캐릭터가 zone 안에서 잠깐 멈추면 자동으로 그 자리의 행동을 한다.
// to: 옮겨 갈 위치(없으면 제자리)  d: 바라볼 방향  a: 동작  p: 'sit'이면 앉음  c: 의자 등받이를 앞에 그림
//   동작: type(타이핑) coffee(커피 마시기) soda(음료) read(책 고르기) write(판서) pingpong(탁구)
const ACT_SPOTS = {
  office: [
    ...DESKS.map((d, i) => ({ id: `desk${i}`, zone: { x: d.x + 10, y: d.y + 19, w: 18, h: 9 }, to: { x: d.x + 19, y: d.y + 24 }, d: 'up', a: 'type', p: 'sit', c: true })),
    ...SOFA_X.map((x, i) => ({ id: `sofa${i}`, zone: { x: x - 6, y: 145, w: 13, h: 4 }, to: { x, y: 141 }, d: 'down', a: 'coffee', p: 'sit' })),
    { id: 'coffeebar', zone: { x: 18, y: 116, w: 7, h: 22 }, d: 'left', a: 'coffee' },
    { id: 'books', zone: { x: 6, y: 52, w: 32, h: 6 }, d: 'up', a: 'read' },
    { id: 'rack', zone: { x: 206, y: 54, w: 26, h: 6 }, d: 'up', a: 'type' },
  ],
  lounge: [
    ...[45, 63, 81, 159, 177, 195].map((x, i) => ({ id: `lsofa${i}`, zone: { x: x - 8, y: 64, w: 17, h: 5 }, to: { x, y: 59 }, d: 'down', a: 'coffee', p: 'sit' })),
    { id: 'vending', zone: { x: 196, y: 56, w: 32, h: 6 }, d: 'down', a: 'soda' },
    { id: 'pingL', zone: { x: 80, y: 104, w: 8, h: 24 }, d: 'right', a: 'pingpong' },
    { id: 'pingR', zone: { x: 152, y: 104, w: 8, h: 24 }, d: 'left', a: 'pingpong' },
  ],
  meeting: [
    ...[0, 1, 2, 3, 4].map((c) => ({ id: `mtop${c}`, zone: { x: 66 + c * 22, y: 50, w: 12, h: 8 }, to: { x: 72 + c * 22, y: 61 }, d: 'down', p: 'sit' })),
    ...[0, 1, 2, 3, 4].map((c) => ({ id: `mbot${c}`, zone: { x: 66 + c * 22, y: 102, w: 12, h: 6 }, to: { x: 72 + c * 22, y: 101 }, d: 'up', p: 'sit' })),
    { id: 'board', zone: { x: 70, y: 28, w: 100, h: 8 }, d: 'up', a: 'write' },
    { id: 'shelf', zone: { x: 214, y: 48, w: 18, h: 6 }, d: 'up', a: 'read' },
  ],
};

// 사용자 캐릭터가 지나갈 수 없는 가구 (발 위치 기준 사각형)
const OBSTACLES = {
  office: [
    { x: 6, y: 26, w: 32, h: 26 }, { x: 206, y: 26, w: 26, h: 28 },
    ...DESKS.map((d) => ({ x: d.x, y: d.y + 8, w: 26, h: 9 })),
    { x: 100, y: 110, w: 40, h: 15 }, { x: 20, y: 128, w: 40, h: 16 },
    { x: 6, y: 118, w: 10, h: 18 }, { x: 220, y: 112, w: 14, h: 26 },
  ],
  lounge: [
    { x: 36, y: 50, w: 54, h: 12 }, { x: 150, y: 50, w: 54, h: 12 },
    { x: 196, y: 26, w: 32, h: 28 }, { x: 90, y: 104, w: 60, h: 24 },
    { x: 8, y: 26, w: 12, h: 22 }, { x: 222, y: 120, w: 12, h: 20 },
  ],
  meeting: [
    { x: 60, y: 58, w: 120, h: 42 }, { x: 214, y: 26, w: 18, h: 22 },
    { x: 8, y: 124, w: 12, h: 20 },
  ],
};

const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x) * S, Math.round(y) * S, w * S, h * S); };

function hash(str) { let h = 0; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }
const SHIRTS = ['#e06c75', '#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#ff9e64', '#f7768e'];
const HAIRS = ['#3b2a20', '#1d1d1d', '#a0522d', '#d8b45c', '#6b4f3a', '#8a8a8a'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac'];
// 흰색 계열은 Codex 칩(흰색)과 헷갈리므로 뺀다
const BANDS = ['#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#f7768e', '#9ece6a', '#7aa2f7'];
const PANTS = ['#2f3a5a', '#3b3b46', '#4a3a2e', '#2e4a3e', '#4a3f5e'];
const lookFor = (seed, shirts = SHIRTS) => {
  const h = hash(seed);
  return { shirt: shirts[h % shirts.length], hair: HAIRS[(h >> 3) % HAIRS.length], skin: SKINS[(h >> 6) % 4], pants: PANTS[(h >> 9) % PANTS.length] };
};

/** 에이전트: id -> { data, x, y, deskIndex, look } */
const agents = new Map();
let sessions = [];

/** 사용자: name -> { name, room, x, y, tx, ty, look, say, sayAt } */
const people = new Map();
let me = null;          // { name, room, x, y, placed }
let viewRoom = 'office'; // 로그인 전에는 탭으로 고른 방, 로그인 후에는 내가 있는 방
const chats = Object.fromEntries(ROOMS.map((r) => [r.id, []]));
const unread = Object.fromEntries(ROOMS.map((r) => [r.id, 0]));

function assignDesks() {
  const used = new Set();
  for (const a of agents.values()) if (a.deskIndex != null) used.add(a.deskIndex);
  for (const a of agents.values()) {
    if (a.data.isSub || a.deskIndex != null) continue;
    const free = DESKS.findIndex((_, i) => !used.has(i));
    if (free >= 0) { a.deskIndex = free; used.add(free); }
  }
}

function targetFor(a, i) {
  const st = a.data.state;
  const jitter = ((i * 7) % 5) * 6 - 12;
  if (SPOTS[st]) {
    const s = SPOTS[st];
    if (st === 'meeting') {
      const ang = (i / 6) * Math.PI * 2;
      return { x: s.x + Math.cos(ang) * 22, y: s.y + Math.sin(ang) * 10 };
    }
    if (st === 'idle') {
      // 처음 세 명은 소파에 앉고, 나머지는 옆 공간에 겹치지 않게 지그재그로
      const k = a.spotRank || 0;
      if (k < 3) return { x: SOFA_X[k], y: 141 };
      return { x: 72 + ((k - 3) % 5) * 14, y: 132 + ((k - 3) % 2) * 10 };
    }
    return { x: s.x, y: s.y + jitter / 2 };
  }
  if (a.deskIndex != null) { const d = DESKS[a.deskIndex]; return { x: d.x + 19, y: d.y + 24 }; } // 의자 자리
  return { x: 120 + jitter * 2, y: 100 }; // 책상 없는 서브에이전트: 사무실 가운데
}

// ---------- 배경 (scenery.js) ----------
const scenery = createScenery({ S, DESKS, ROOM_BY_ID, DOOR_Y0, DOOR_Y1 });

// ---------- 캐릭터 (sprites.js) ----------
const dirFrom = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));

// 멈춰 있을 때의 자세: 방향, 앉음, 동작(type/coffee/...), 의자 등받이
function poseOf(a) {
  if (a.data.agent === 'human') {
    const x = a.act;
    return x ? { dir: x.d, sit: x.p === 'sit', anim: x.a, chair: x.c } : { dir: a.dir || 'down' };
  }
  const st = a.data.state;
  if (st === 'idle') return { dir: 'down', sit: (a.spotRank || 0) < 3, anim: 'coffee' };
  if (st === 'reading') return { dir: 'up', anim: 'read' };
  if (st === 'terminal') return { dir: 'up', anim: 'type' };
  if (st === 'meeting') return { dir: dirFrom(SPOTS.meeting.x - a.x, SPOTS.meeting.y - 3 - a.y) };
  if (a.deskIndex != null) return { dir: 'up', sit: true, chair: true, anim: st === 'typing' || st === 'working' ? 'type' : null };
  return { dir: 'down' };
}

// 몸통만 그린다(말풍선·이름표는 drawOverlay에서 모든 캐릭터 위에)
function drawBody(a, t) {
  const st = a.data.state;
  const sc = a.data.isSub ? 0.75 : 1;
  const P = S * sc; // 도트 1개의 화면 크기
  const pose = a.moving ? { dir: a.dir || 'down' } : poseOf(a);
  const dir = pose.dir || 'down';
  const frame = a.moving ? Math.floor((t + a.seed * 37) / 110) % 4 : 0;
  const blink = (t + a.seed * 997) % 4200 < 130;
  // 팔 움직임: 타이핑은 빠르게, 판서·책 고르기는 천천히
  const armSpeed = { type: 110, write: 260, read: 700 }[pose.anim];
  const type = !!armSpeed && Math.floor(t / armSpeed) % 2 === 1;
  const spr = Sprites.get(a.look, { kind: a.data.agent, dir, frame, blink, type, sit: pose.sit });
  const w = spr.width * sc, h = spr.height * sc;
  let yOff = 0;
  if (a.moving && frame % 2 === 0) yOff = -P;                                       // 걸을 때 위아래 출렁임
  else if (!a.moving && st === 'waiting') yOff = Math.floor(t / 450) % 2 ? -P : 0;  // 승인 대기: 제자리 콩콩
  else if (!a.moving && st === 'thinking') yOff = Math.floor(t / 900) % 2 ? -P * 0.5 : 0;
  const sx = Math.round(a.x * S - w / 2), sy = Math.round(a.y * S - h + yOff);

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(a.x * S, a.y * S - 1, 17 * sc, 5 * sc, 0, 0, Math.PI * 2); ctx.fill();
  if (dir === 'left') { ctx.save(); ctx.translate(sx + w, sy); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0, w, h); ctx.restore(); }
  else ctx.drawImage(spr, sx, sy, w, h);

  // 뒷모습으로 의자에 앉으면 등받이가 허리 아래를 가린다
  if (pose.sit && pose.chair && dir === 'up') { // 발끝 기준. 키 작은 Claude 캐릭터는 등받이도 낮게
    const cx = a.x * S, fy = a.y * S, bh = a.data.agent === 'claude' ? 3 : 5;
    ctx.fillStyle = '#1a1b26'; ctx.fillRect(cx - 4.5 * P, fy - (bh + 1) * P, 9 * P, bh * P);
    ctx.fillStyle = '#3c4160'; ctx.fillRect(cx - 3.5 * P, fy - bh * P, 7 * P, (bh - 2) * P);
    ctx.fillStyle = '#4a4f72'; ctx.fillRect(cx - 3.5 * P, fy - bh * P, 7 * P, P);
    ctx.fillStyle = '#2a2d42'; ctx.fillRect(cx - P, fy - P, 2 * P, 2 * P);
  }
  if (!a.moving) drawProps(a, pose, sx, sy, P, t, spr.width / Sprites.PX);
  a._top = sy + (pose.sit ? 2 * P : 0); // 앉은 스프라이트는 위 2줄이 비어 있음
}

// 손에 든 소품: 스프라이트 안의 도트 좌표(lx, ly)로 그린다. 왼쪽을 볼 때는 좌우 반전
function drawProps(a, pose, sx, sy, P, t, W) {
  const { dir, anim } = pose;
  if (!anim || dir === 'up') return;
  const flip = dir === 'left';
  const dot = (lx, ly, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(sx + (flip ? W - lx - w : lx) * P, sy + ly * P, w * P, h * P); };
  const lift = pose.sit ? 2 : 0;          // 앉으면 손 위치도 2줄 내려감
  const side = dir !== 'down';
  const L0 = Sprites.layout(a.data.agent);
  const h0 = L0.hand[side ? 'side' : 'down'], s0 = L0.sip[side ? 'side' : 'down'];
  const hand = { x: h0.x, y: h0.y + lift };
  const sip = (t + a.seed * 300) % 4200 < 900; // 4초쯤마다 한 모금

  if (anim === 'coffee' || anim === 'soda') {
    // 마실 때는 컵이 입 앞으로 올라온다
    const at = sip ? { x: s0.x, y: s0.y + lift } : { x: hand.x, y: hand.y - 1 };
    if (anim === 'coffee') {
      dot(at.x - 0.5, at.y - 0.5, 3, 3.5, '#1a1b26');
      dot(at.x, at.y, 2, 2.5, '#f4efe1');
      dot(at.x, at.y, 2, 0.75, '#6b4a2f');
      if (!sip && Math.random() < 0.025)
        scenery.emit((sx + (flip ? W - at.x - 1 : at.x + 1) * P) / S, (sy + at.y * P) / S - 1, { room: viewRoom, a: 0.35 });
    } else {
      dot(at.x - 0.5, at.y - 0.5, 2.5, 3.5, '#1a1b26');
      dot(at.x, at.y, 1.5, 2.5, '#e06c75');
      dot(at.x, at.y, 1.5, 0.75, '#d8dce8');
    }
  } else if (anim === 'pingpong') {
    // 공이 내 쪽으로 오면 라켓을 휘두른다 (scenery.js의 공 궤적과 같은 식)
    const bx = 120 + Math.sin(t / 320) * 24;
    const near = a.x < 120 ? bx < 104 : bx > 136;
    const p = near ? { x: 8, y: 6 + lift } : { x: 7, y: 9 + lift };
    dot(p.x - 0.5, p.y - 0.5, 3, 3, '#1a1b26');
    dot(p.x, p.y, 2, 2, a.x < 120 ? '#c94f4f' : '#2a2d42');
    dot(p.x + 0.5, p.y + 2, 1, 1.5, '#6b4a2f');
  }
}

// ---------- 글씨 레이어 ----------
// 도트 캔버스(960x600)는 화면 폭에 맞춰 늘거나 줄어서, 그 안에 쓴 글씨는 작은 화면에서 깨진다.
// 그래서 글씨(이름표·말풍선·문 이름표)는 위에 겹친 캔버스에 실제 화면 해상도로 따로 그린다.
const labels = document.getElementById('labels');
const L = labels.getContext('2d');
const view = { k: 1, f: 1 }; // k: 도트 캔버스 px → 화면 CSS px, f: 글씨 배율
function fitLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w) return;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (labels.width !== bw || labels.height !== bh) {
    labels.width = bw; labels.height = bh;
    // 화면에서 줄어들 때 또렷하게(nearest) 줄이면 도트 줄이 빠져 보이므로 부드럽게 줄인다
    canvas.style.imageRendering = bw < canvas.width ? 'auto' : 'pixelated';
  }
  L.setTransform(dpr, 0, 0, dpr, 0, 0);
  L.clearRect(0, 0, w, h);
  view.k = w / canvas.width;
  view.f = Math.min(1.1, Math.max(0.82, view.k * 1.5)); // 폰에서도 9px 아래로는 안 줄어듦
}
const FONT_FAMILY = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const font = (px, bold) => `${bold ? 700 : 500} ${Math.round(px * view.f)}px ${FONT_FAMILY}`;

// 캔버스 글씨는 웹폰트를 스스로 내려받지 않는다. Pretendard는 글자 범위별로 나눠 받으므로
// 캔버스에 처음 쓰는 글자(이름·채팅)가 생기면 그 글자가 든 조각을 미리 요청해 둔다.
const fontRequested = new Set();
function ensureFont(text) {
  if (!document.fonts || fontRequested.has(text)) return;
  fontRequested.add(text);
  document.fonts.load(`500 12px "Pretendard Variable"`, text).catch(() => {});
}

function drawOverlay(a, t) {
  const { k, f } = view;
  const st = a.data.state;
  const sx = a.x * S * k;
  const top = (a._top ?? (a.y - 17) * S) * k;
  const feet = a.y * S * k;
  // 상태 말풍선
  const bubble = { thinking: '…', waiting: '!', idle: '☕', meeting: '💬', terminal: '>_', reading: '📖', browsing: '🌐' }[st];
  if (bubble && !a.moving) {
    const b = 0.8 * f * (st === 'waiting' ? 1 + Math.sin(t / 150) * 0.15 : 1);
    L.save(); L.translate(sx, top - 16 * 0.8 * f); L.scale(b, b);
    L.fillStyle = '#1a1b26';
    L.beginPath(); L.roundRect(-16, -14, 32, 24, 6); L.fill();
    L.fillStyle = st === 'waiting' ? '#ff5c7a' : '#f4efe1';
    L.beginPath(); L.roundRect(-14, -12, 28, 20, 5); L.fill();
    L.beginPath(); L.moveTo(-4, 8); L.lineTo(4, 8); L.lineTo(0, 14); L.fill();
    L.fillStyle = st === 'waiting' ? '#fff' : '#1b1d2a';
    L.font = `700 13px ${FONT_FAMILY}`; L.textAlign = 'center'; L.textBaseline = 'middle';
    L.fillText(st === 'thinking' ? '.'.repeat(1 + (Math.floor(t / 400) % 3)) : bubble, 0, -2);
    L.restore();
  }
  // 채팅 말풍선 (6초간, 마지막 1초는 서서히 사라짐)
  const age = a.say ? Date.now() - a.sayAt : Infinity;
  if (age < 6000) {
    const text = a.say.length > 22 ? a.say.slice(0, 21) + '…' : a.say;
    L.globalAlpha = Math.min(1, (6000 - age) / 1000);
    ensureFont(text);
    L.font = font(12); L.textAlign = 'center'; L.textBaseline = 'middle';
    const w = L.measureText(text).width + 12 * f, h = 20 * f, by = top - h - 10 * f;
    L.fillStyle = '#1a1b26'; L.beginPath(); L.roundRect(sx - w / 2 - 2, by - 2, w + 4, h + 4, 7); L.fill();
    L.fillStyle = '#ffffff'; L.beginPath(); L.roundRect(sx - w / 2, by, w, h, 6); L.fill();
    L.beginPath(); L.moveTo(sx - 4 * f, by + h); L.lineTo(sx + 4 * f, by + h); L.lineTo(sx, by + h + 6 * f); L.fill();
    L.fillStyle = '#1b1d2a'; L.fillText(text, sx, by + h / 2 + 0.5);
    L.globalAlpha = 1;
  }
  // 이름표: 사람은 이름만, 에이전트는 [Claude|Codex 칩] 세션 이름 + 아래 줄에 칭호 · 프로젝트
  const name = a.data.title.length > 14 ? a.data.title.slice(0, 13) + '…' : a.data.title;
  ensureFont(name);
  L.textBaseline = 'middle';
  const kind = KIND_CHIP[a.data.agent];
  // 소파에 나란히 앉은 에이전트는 이름표가 겹치므로 한 칸 건너 머리 위(말풍선 위)로 올린다
  const up = kind && st === 'idle' && !a.moving && (a.spotRank || 0) % 2 === 1;
  const h = 15 * f, block = h + (kind ? 13.5 * f : 0);
  // 화면 맨 아래에서는 이름표가 잘리지 않게 위로 붙인다
  const y0 = up ? top - 30 * f - block : Math.min(feet + 2 * f, canvas.clientHeight - block - 3);
  L.font = font(11); const nameW = L.measureText(name).width;
  L.font = font(9, true); const chipW = kind ? L.measureText(kind.label).width + 8 * f : 0;
  const w = nameW + 10 * f + (kind ? chipW + 4 * f : 0), x0 = sx - w / 2;
  L.fillStyle = a.isMe ? '#f5c26be8' : '#14151fd0';
  L.beginPath(); L.roundRect(x0, y0, w, h, 4); L.fill();
  if (kind) { // 왼쪽 칩
    L.fillStyle = a.band || kind.bg;
    L.beginPath(); L.roundRect(x0 + 2 * f, y0 + 2 * f, chipW, h - 4 * f, 3); L.fill();
    L.fillStyle = kind.fg; L.textAlign = 'center';
    L.fillText(kind.label, x0 + 2 * f + chipW / 2, y0 + h / 2 + 0.5);
  }
  L.font = font(11); L.textAlign = 'left';
  L.fillStyle = a.isMe ? '#1b1d2a' : a.data.agent === 'human' ? '#ffffff' : STATE_INFO[st]?.color || '#fff';
  L.fillText(name, x0 + (kind ? chipW + 6 * f : 5 * f), y0 + h / 2 + 0.5);
  // 둘째 줄: 칭호 · 프로젝트
  if (kind) {
    const sub = [titleFor(a.data), a.data.project].filter(Boolean).join(' · ');
    const line = sub.length > 26 ? sub.slice(0, 25) + '…' : sub;
    ensureFont(line);
    L.font = font(9); L.textAlign = 'center';
    const w2 = L.measureText(line).width + 8 * f, h2 = 12 * f, y2 = y0 + h + 1.5 * f;
    L.fillStyle = '#14151fa8'; L.beginPath(); L.roundRect(sx - w2 / 2, y2, w2, h2, 3); L.fill();
    L.fillStyle = '#c0caf5'; L.fillText(line, sx, y2 + h2 / 2 + 0.5);
  }
}

// 에이전트 종류 칩 (Claude 칩은 그 세션 머리띠 색으로 칠해 화면 속 캐릭터와 짝을 맞춘다)
const KIND_CHIP = {
  claude: { label: 'Claude', bg: '#d97757', fg: '#1b1d2a' },
  codex:  { label: 'Codex',  bg: '#e6e6f0', fg: '#111318' },
};

// 칭호: 서브에이전트는 '조수', 나머지는 이 세션에서 쓴 도구 횟수로
function titleFor(d) {
  if (d.isSub) return '🧩 조수';
  const n = d.tools || 0;
  if (n >= 300) return '👑 전설';
  if (n >= 120) return '🏅 베테랑';
  if (n >= 40) return '⚡ 숙련';
  if (n >= 10) return '🌱 신입';
  return '🐣 인턴';
}

// 옆방으로 가는 문 이름표
function drawDoorLabels() {
  const { k, f } = view, idx = ROOM_BY_ID[viewRoom].index;
  L.font = font(11, true); L.textBaseline = 'middle'; L.textAlign = 'left';
  const y = (DOOR_Y0 - 5) * S * k;
  for (const [side, room] of [['left', ROOMS[idx - 1]], ['right', ROOMS[idx + 1]]]) {
    if (!room) continue;
    const text = side === 'right' ? `${room.name} ▶` : `◀ ${room.name}`;
    ensureFont(text);
    const w = L.measureText(text).width + 12 * f, h = 18 * f;
    const x = side === 'right' ? 233 * S * k - w : 7 * S * k;
    L.fillStyle = '#14151fc8'; L.beginPath(); L.roundRect(x, y - h / 2, w, h, 4); L.fill();
    L.fillStyle = '#f4efe1'; L.fillText(text, x + 6 * f, y + 0.5);
  }
}

// 사람 → drawBody/drawOverlay가 그릴 수 있는 모양으로
function personSprite(p, isMe) {
  return { x: p.x, y: p.y, look: p.look, moving: p.moving, dir: p.dir || 'down', act: p.act || null, seed: hash(p.name) % 1000,
    say: p.say, sayAt: p.sayAt, isMe, data: { title: p.name, state: 'human', agent: 'human', isSub: false } };
}

// ---------- 내 캐릭터 이동 ----------
const keys = new Set();
const KEYMAP = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const typingInField = (e) => /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
addEventListener('keydown', (e) => {
  if (typingInField(e)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (KEYMAP[e.key] && me) { keys.add(e.key); e.preventDefault(); }
  if (e.key === 'Enter' && me) { document.getElementById('chat-input').focus(); e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.key));
addEventListener('blur', () => { keys.clear(); resetJoy(); });

// ---------- 터치 조이스틱 ----------
// 손가락을 중심에서 끄는 거리(0~1)만큼 속도가 붙는 아날로그 방식
const isTouch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);
const joyEl = document.getElementById('joystick');
const joyKnob = document.getElementById('joy-knob');
const joy = { x: 0, y: 0, pointer: null };

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
  joyKnob.style.transform = ''; joyEl.classList.remove('active');
}
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

function blocked(room, x, y) {
  if (x < 5 || x > 235 || y < 30 || y > 148) return true;
  return OBSTACLES[room].some((r) => x > r.x - 2 && x < r.x + r.w + 2 && y > r.y && y < r.y + r.h + 2);
}

let lastMoveSent = 0, dirtyMove = false;
function moveMe(dt) {
  if (!me || !me.placed) return;
  let vx = 0, vy = 0;
  for (const k of keys) { vx += KEYMAP[k][0]; vy += KEYMAP[k][1]; }
  let power = 1;
  if (!vx && !vy && (joy.x || joy.y)) { vx = joy.x; vy = joy.y; power = Math.min(1, Math.hypot(vx, vy)); }
  me.moving = !!(vx || vy);
  if (!me.moving) {
    // 상호작용 자리에서 잠깐(0.35초) 멈추면 자동으로 앉거나 마시기 시작
    me.still = (me.still || 0) + dt;
    if (!me.act && me.still > 0.35) startAct();
    return;
  }
  me.still = 0;
  if (me.act) { // 움직이면 행동을 그만두고 원래 서 있던 자리에서 출발
    me.x = me.act.sx ?? me.x; me.y = me.act.sy ?? me.y; me.act = null;
  }
  // 어떤 이유로든 가구 안에 서 있으면(앉은 정보만 사라진 경우 등) 가장 가까운 빈자리로 빠져나온다
  if (blocked(me.room, me.x, me.y)) unstick();
  me.dir = dirFrom(vx, vy);
  const len = Math.hypot(vx, vy), sp = 60 * dt * power;
  const nx = me.x + (vx / len) * sp, ny = me.y + (vy / len) * sp;
  const idx = ROOM_BY_ID[me.room].index;
  const inDoor = ny > DOOR_Y0 + 2 && ny < DOOR_Y1 - 2;
  // 벽(blocked)이 x 5~235에서 막으므로 문 판정은 그 경계에서 한다
  if (nx >= 235 && inDoor && ROOMS[idx + 1]) return enterRoom(ROOMS[idx + 1].id, 10, ny);
  if (nx <= 5 && inDoor && ROOMS[idx - 1]) return enterRoom(ROOMS[idx - 1].id, 230, ny);
  if (!blocked(me.room, nx, me.y)) me.x = nx;
  if (!blocked(me.room, me.x, ny)) me.y = ny;
  dirtyMove = true;
}

const inZone = (x, y, z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;

// 막힌 곳에 있으면 주변을 동심원으로 넓혀 가며 가장 가까운 빈자리를 찾는다
function unstick() {
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
  for (const p of people.values()) if (p.name !== me.name && p.room === me.room && p.act?.id === id) return true;
  if (me.room !== 'office') return false;
  for (const a of agents.values()) {
    if (id === `desk${a.deskIndex}` && !SPOTS[a.data.state]) return true;
    if (a.data.state === 'idle' && id === `sofa${a.spotRank}`) return true;
  }
  return false;
}

function startAct() {
  const spot = (ACT_SPOTS[me.room] || []).find((s) => inZone(me.x, me.y, s.zone) && !spotTaken(s.id));
  if (!spot) return;
  me.act = { id: spot.id, a: spot.a || null, p: spot.p || 'stand', d: spot.d, c: !!spot.c, sx: me.x, sy: me.y };
  if (spot.to) { me.x = spot.to.x; me.y = spot.to.y; }
  me.dir = spot.d;
  sendMove(true);
}

function enterRoom(room, x, y) {
  me.act = null;
  me.room = room; me.x = x; me.y = y; viewRoom = room;
  unread[room] = 0;
  sendMove(true);
  renderTabs(); renderChat();
}

function sendMove(force) {
  const now = performance.now();
  if (!me || !socket || (!force && (!dirtyMove || now - lastMoveSent < 50))) return;
  lastMoveSent = now; dirtyMove = false;
  // sx, sy: 앉기 전 서 있던 자리 (다시 접속했을 때 가구 안에 갇히지 않도록 서버가 여기로 되돌림)
  const act = me.act && { id: me.act.id, a: me.act.a, p: me.act.p, d: me.act.d, c: me.act.c, sx: me.act.sx, sy: me.act.sy };
  socket.emit('move', { room: me.room, x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, act });
}

// ---------- 루프 ----------
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;

  // 에이전트는 화면에 안 보여도 계속 사무실 안에서 움직인다
  const list = [...agents.values()];
  let idleRank = 0;
  list.forEach((a) => { a.spotRank = a.data.state === 'idle' ? idleRank++ : 0; });
  list.forEach((a, i) => {
    const tg = targetFor(a, i);
    const dx = tg.x - a.x, dy = tg.y - a.y, dist = Math.hypot(dx, dy);
    a.moving = dist > 1;
    if (a.moving) { const sp = Math.min(dist, 45 * dt); a.x += (dx / dist) * sp; a.y += (dy / dist) * sp; a.dir = dirFrom(dx, dy); }
    else a.dir = poseOf(a).dir;
  });

  // 다른 사람: 서버 위치를 향해 부드럽게 따라감
  for (const p of people.values()) {
    const dx = p.tx - p.x, dy = p.ty - p.y, dist = Math.hypot(dx, dy);
    p.moving = dist > 0.5;
    if (p.moving) { const sp = Math.min(dist, 90 * dt); p.x += (dx / dist) * sp; p.y += (dy / dist) * sp; if (dist > 1) p.dir = dirFrom(dx, dy); }
  }
  moveMe(dt);
  sendMove(false);

  // 배경 + 움직이는 소품 (책상 모니터는 앉아 있는 에이전트 상태를 따름)
  const sk = scenery.sky();
  const info = {};
  if (viewRoom === 'office') {
    const deskState = new Map(list.filter((a) => a.deskIndex != null).map((a) => [a.deskIndex, a]));
    // 사람이 앉은 책상: 모니터에 코드가 흐르고 빈 의자는 감춘다
    const humanDesks = new Set();
    for (const p of [...people.values(), me || {}]) if (p.room === 'office' && p.act?.id?.startsWith('desk')) humanDesks.add(+p.act.id.slice(4));
    info.desks = DESKS.map((_, i) => {
      const a = deskState.get(i);
      const atDesk = a && !a.moving && !SPOTS[a.data.state];
      if (!atDesk && humanDesks.has(i)) return { st: 'typing', occupied: true };
      return { st: atDesk ? a.data.state : null, occupied: !!atDesk };
    });
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  scenery.drawBase(ctx, viewRoom, t, dt, sk, info);

  const sprites = viewRoom === 'office' ? [...list] : [];
  for (const p of people.values()) if (p.room === viewRoom && (!me || p.name !== me.name)) sprites.push(personSprite(p, false));
  if (me && me.placed && me.room === viewRoom) {
    const mine = people.get(me.name);
    sprites.push(personSprite({ ...me, look: lookFor(me.name), say: mine?.say, sayAt: mine?.sayAt }, true));
  }
  sprites.sort((p, q) => p.y - q.y); // 아래쪽이 앞에 보이도록
  sprites.forEach((a) => drawBody(a, t));
  scenery.drawOver(ctx, viewRoom, dt, sk); // 김·먼지, 밤 색조, 빛번짐, 비네팅
  fitLabels();
  drawDoorLabels();
  sprites.forEach((a) => drawOverlay(a, t));

  if (viewRoom === 'office' && !list.length) {
    const { k, f } = view, cx = canvas.clientWidth / 2, cy = 100 * S * k;
    L.font = font(14); L.textAlign = 'center'; L.textBaseline = 'middle';
    const msg = '최근 30분간 활동한 에이전트 세션이 없어요', w = L.measureText(msg).width + 24 * f, h = 30 * f;
    ensureFont(msg);
    L.fillStyle = '#14151fc8'; L.beginPath(); L.roundRect(cx - w / 2, cy - h / 2, w, h, 8); L.fill();
    L.fillStyle = '#f4efe1'; L.fillText(msg, cx, cy + 0.5);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- 데이터 ----------
function sync(data) {
  sessions = data;
  const ids = new Set(data.map((d) => d.id));
  for (const id of agents.keys()) if (!ids.has(id)) agents.delete(id);
  for (const d of data) {
    let a = agents.get(d.id);
    if (!a) {
      a = { x: 120, y: 148, deskIndex: null, moving: true, dir: 'up', seed: hash(d.id) % 1000,
            look: lookFor(d.id, d.agent === 'codex' ? ['#2d3340', '#3b4252', '#1f6f5c'] : SHIRTS) };
      // Claude 세션마다 다른 머리띠 색: 목록 카드·이름표 칩과 같은 색이라 누가 누군지 짝이 맞는다
      if (d.agent === 'claude') a.band = a.look.band = BANDS[hash(d.id) % BANDS.length];
      agents.set(d.id, a);
    }
    a.data = d;
  }
  assignDesks();
  renderList();
  renderTabs();
}

function syncOwnPosition(s) {
  if (!me || s.name !== me.name) return;
  Object.assign(me, { room: s.room, x: s.x, y: s.y, placed: true, moving: false,
    act: s.act ? { ...s.act, sx: s.act.sx ?? s.x, sy: s.act.sy ?? s.y } : null });
  if (s.act) me.dir = s.act.d;
  dirtyMove = false;
  keys.clear(); resetJoy();
  viewRoom = s.room; unread[s.room] = 0;
  renderChat(); renderTabs();
}

function syncPeople(list) {
  const names = new Set(list.map((p) => p.name));
  for (const n of people.keys()) if (!names.has(n)) people.delete(n);
  for (const s of list) {
    let p = people.get(s.name);
    if (!p) { p = { name: s.name, x: s.x, y: s.y, look: lookFor(s.name) }; people.set(s.name, p); }
    if (p.room !== s.room) { p.x = s.x; p.y = s.y; } // 방을 옮기면 걸어오지 않고 바로 등장
    p.room = s.room; p.tx = s.x; p.ty = s.y; p.act = s.act || null;
    if (p.act) p.dir = p.act.d;
    if (me && s.name === me.name && !me.placed) {
      syncOwnPosition(s);
    }
  }
  renderTabs();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ago(ts) { if (!ts) return ''; const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? `${s}초 전` : `${Math.round(s / 60)}분 전`; }
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

function renderList() {
  const el = document.getElementById('list');
  if (!sessions.length) { el.innerHTML = '<div class="card empty">활동 중인 에이전트 세션 없음</div>'; return; }
  el.innerHTML = sessions.map((s) => {
    const info = STATE_INFO[s.state] || STATE_INFO.working;
    const a = agents.get(s.id);
    return `<div class="card">
      <div class="top"><span class="dot" style="background:${a?.band || a?.look.shirt}"></span>
        <span class="who ${s.agent}"${a?.band ? ` style="background:${a.band}"` : ''}>${s.agent === 'codex' ? 'Codex' : 'Claude'}</span>
        <span class="name" title="${esc(s.title)}">${s.isSub ? '↳ ' : ''}${esc(s.title)}</span>
        <span class="badge" style="color:${info.color}">${info.label}</span></div>
      <div class="rank">${titleFor(s)}</div>
      <div class="detail">${esc(s.detail || '')}</div>
      <div class="detail">${esc(s.project)} · 도구 ${s.tools}회 · ${ago(s.lastEvent)}</div>
      ${s.log.length ? `<ul class="log">${s.log.slice().reverse().map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
}
setInterval(renderList, 5000);

// 방 탭: 로그인 전엔 구경할 방을 고르고, 로그인 후엔 그 방으로 바로 이동
function renderTabs() {
  const el = document.getElementById('tabs');
  el.innerHTML = ROOMS.map((r) => {
    const humans = [...people.values()].filter((p) => p.room === r.id).length;
    const bots = r.id === 'office' ? agents.size : 0;
    const count = [humans && `👤${humans}`, bots && `🤖${bots}`].filter(Boolean).join(' ');
    return `<button class="tab${r.id === viewRoom ? ' on' : ''}" data-room="${r.id}">${r.name}
      ${count ? `<small>${count}</small>` : ''}${unread[r.id] ? `<b class="unread">${unread[r.id]}</b>` : ''}</button>`;
  }).join('');
}
document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-room]');
  if (!b || b.dataset.room === viewRoom) return;
  const id = b.dataset.room;
  if (me && me.placed) enterRoom(id, SPAWN[id].x, SPAWN[id].y);
  else { viewRoom = id; unread[id] = 0; renderTabs(); renderChat(); }
  canvas.focus();
});

// ---------- 채팅 ----------
function renderChat() {
  document.getElementById('chat-title').textContent = `# ${ROOM_BY_ID[viewRoom].name} 채팅`;
  const box = document.getElementById('chat-log');
  const msgs = chats[viewRoom];
  box.innerHTML = msgs.length
    ? msgs.map((m) => `<div class="msg${me && m.name === me.name ? ' mine' : ''}"><span class="t">${hhmm(m.t)}</span> <b>${esc(m.name)}</b> ${esc(m.text)}</div>`).join('')
    : '<div class="empty">아직 대화가 없어요</div>';
  box.scrollTop = box.scrollHeight;
  const input = document.getElementById('chat-input');
  input.disabled = !me;
  input.placeholder = me ? `${ROOM_BY_ID[viewRoom].name}에 메시지 보내기 (Enter)` : '로그인하면 채팅할 수 있어요';
}

function onChat(m) {
  chats[m.room].push(m); if (chats[m.room].length > 100) chats[m.room].shift();
  const p = people.get(m.name);
  if (p) { p.say = m.text; p.sayAt = Date.now(); }
  if (m.room === viewRoom) renderChat();
  else { unread[m.room]++; renderTabs(); }
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !me || !socket) return;
  // 서버가 저장·전송을 마치면 ack 콜백으로 결과를 알려준다
  socket.timeout(5000).emit('chat', { text, room: viewRoom }, (err, res) => {
    if (err) return flash('전송 시간 초과');
    if (res?.error) return flash(res.error);
    input.value = '';
  });
});

// ---------- 로그인 ----------
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `요청 실패 (${r.status})`);
  return j;
}
function flash(msg) { const el = document.getElementById('auth-msg'); el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000); }

function renderAuth() {
  document.getElementById('auth-out').hidden = !!me;
  document.getElementById('auth-in').hidden = !me;
  if (me) document.getElementById('me-name').textContent = me.name;
  joyEl.hidden = !(me && isTouch);
  if (joyEl.hidden) resetJoy();
  renderChat();
}

async function doAuth(kind) {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const { name } = await api(`/api/${kind}`, { username, password });
    me = { name, room: 'office', x: 0, y: 0, placed: false };
    document.getElementById('password').value = '';
    renderAuth(); connect(); canvas.focus();
  } catch (err) { flash(err.message); }
}
document.getElementById('auth-form').addEventListener('submit', (e) => { e.preventDefault(); doAuth('login'); });
document.getElementById('signup').addEventListener('click', () => doAuth('signup'));
document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/logout').catch(() => {});
  me = null; keys.clear(); renderAuth(); connect();
});

// ---------- 실시간 연결 (socket.io / WebSocket) ----------
const conn = document.getElementById('conn');
let socket;
// 로그인·로그아웃하면 새 쿠키로 다시 연결해야 서버가 누구인지 안다
function connect() {
  if (socket) socket.disconnect();
  socket = io({ forceNew: true });
  socket.on('connect', () => {
    conn.textContent = '● 실시간 연결됨'; conn.style.color = '#7bd88f';
    // Reconcile with the server after reconnecting; another tab may have moved.
    if (me) { me.placed = false; dirtyMove = false; }
  });
  socket.on('disconnect', () => { conn.textContent = '○ 재연결 중…'; conn.style.color = '#ff5c7a'; });
  socket.on('agents', sync);
  socket.on('players', syncPeople);
  socket.on('playerMoved', syncOwnPosition);
  socket.on('sessionExpired', () => {
    me = null; dirtyMove = false; keys.clear();
    renderAuth(); renderTabs();
    flash('로그인 세션이 종료됐어요. 다시 로그인해주세요.');
    connect();
  });
  socket.on('history', (h) => {
    for (const r of ROOMS) chats[r.id] = h[r.id] || [];
    renderChat();
  });
  socket.on('chat', onChat);
}

(async () => {
  try {
    const { name } = await fetch('/api/me').then((r) => r.json());
    if (name) me = { name, room: 'office', x: 0, y: 0, placed: false };
  } catch { /* 서버 꺼짐 */ }
  renderAuth(); renderTabs(); connect();
})();
