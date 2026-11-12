// Pixel Office 렌더러: 서버가 보내는 세션 상태를 픽셀 캐릭터로 그린다
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

// 사무실 배치
const DESKS = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) DESKS.push({ x: 56 + c * 36, y: 38 + r * 34 });
const SPOTS = {
  reading:  { x: 22, y: 56 },
  terminal: { x: 218, y: 56 },
  meeting:  { x: 120, y: 118 },
  idle:     { x: 30, y: 132 },
};

const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x) * S, Math.round(y) * S, w * S, h * S); };

function hash(str) { let h = 0; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }
const SHIRTS = ['#e06c75', '#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#ff9e64', '#f7768e'];
const HAIRS = ['#3b2a20', '#1d1d1d', '#a0522d', '#d8b45c', '#6b4f3a', '#8a8a8a'];

/** id -> { data, x, y, deskIndex, look } */
const agents = new Map();
let sessions = [];

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
      // 쉬는 사람끼리 겹치지 않게 휴게 공간에 지그재그로 배치
      const k = a.spotRank || 0;
      return { x: 18 + (k % 6) * 30, y: 128 + (k % 2) * 14 };
    }
    return { x: s.x, y: s.y + jitter / 2 };
  }
  if (a.deskIndex != null) { const d = DESKS[a.deskIndex]; return { x: d.x + 21, y: d.y + 25 }; }
  return { x: 120 + jitter * 2, y: 100 }; // 책상 없는 서브에이전트: 사무실 가운데
}

// ---------- 배경 ----------
function drawOffice(t) {
  // 바닥
  for (let y = 24; y < 150; y += 8) for (let x = 0; x < 240; x += 8)
    px(x, y, 8, 8, ((x + y) / 8) % 2 ? '#3a3f5c' : '#363a55');
  // 벽 + 창문
  px(0, 0, 240, 24, '#4a4e6e'); px(0, 22, 240, 2, '#2a2d42');
  for (let i = 0; i < 4; i++) {
    const wx = 40 + i * 48;
    px(wx, 4, 28, 14, '#2a2d42');
    const sky = `hsl(${205 + Math.sin(t / 8000) * 10}, 60%, ${55 + Math.sin(t / 5000 + i) * 5}%)`;
    px(wx + 1, 5, 26, 12, sky); px(wx + 13, 5, 2, 12, '#2a2d42');
  }
  // 책장
  px(6, 26, 32, 24, '#6b4a2f');
  for (let r = 0; r < 3; r++) {
    px(8, 28 + r * 7, 28, 6, '#4a321f');
    for (let b = 0; b < 7; b++) px(9 + b * 4, 29 + r * 7, 3, 5, SHIRTS[(b + r * 3) % SHIRTS.length]);
  }
  // 서버랙 (깜빡이는 LED)
  for (let k = 0; k < 2; k++) {
    const rx = 206 + k * 14;
    px(rx, 26, 12, 26, '#1f2233'); px(rx + 1, 27, 10, 24, '#2c3047');
    for (let l = 0; l < 6; l++) {
      px(rx + 2, 29 + l * 4, 8, 2, '#3c4160');
      if (Math.sin(t / 150 + l * 2 + k * 5) > 0.2) px(rx + 8, 29 + l * 4, 1, 1, l % 2 ? '#7bd88f' : '#ff9e64');
    }
  }
  // 회의 테이블
  px(100, 112, 40, 12, '#7a5636'); px(100, 112, 40, 2, '#93694a');
  // 휴게 공간: 소파 + 커피머신 + 화분
  px(20, 134, 40, 10, '#8f5e9e'); px(20, 130, 40, 5, '#a874b8');
  px(6, 120, 10, 16, '#c8ccd8'); px(8, 123, 6, 4, '#2a2d42'); px(9, 131, 4, 3, '#6b4a2f');
  px(222, 128, 10, 10, '#a0522d'); px(220, 116, 14, 12, '#4f9d69'); px(224, 112, 6, 6, '#5fb87b');
}

function drawDesk(i, screen) {
  const d = DESKS[i];
  px(d.x, d.y + 8, 26, 8, '#8a6544'); px(d.x, d.y + 8, 26, 2, '#a07a55'); // 책상
  px(d.x + 2, d.y + 16, 2, 6, '#5c4330'); px(d.x + 22, d.y + 16, 2, 6, '#5c4330');
  px(d.x + 7, d.y, 12, 8, '#1f2233'); // 모니터
  px(d.x + 8, d.y + 1, 10, 6, screen || '#2c3047');
  px(d.x + 12, d.y + 8, 2, 1, '#1f2233');
}

function drawScreenContent(i, state, t) {
  const d = DESKS[i];
  if (state === 'typing' || state === 'working') {
    for (let l = 0; l < 3; l++) {
      const w = 2 + ((Math.floor(t / 200) + l * 3 + i) % 7);
      px(d.x + 9, d.y + 2 + l * 2, Math.min(w, 8), 1, l === 1 ? '#7bd88f' : '#c0caf5');
    }
  } else if (state === 'browsing') {
    px(d.x + 9, d.y + 2, 8, 1, '#ffffff'); px(d.x + 9, d.y + 4, 4, 2, '#f5c26b'); px(d.x + 14, d.y + 4, 3, 2, '#c0caf5');
  }
}

// ---------- 캐릭터 ----------
function drawAgent(a, t) {
  const { x, y, look, moving } = a;
  const st = a.data.state;
  const step = moving ? Math.floor(t / 120) % 2 : 0;
  const bob = st === 'typing' || st === 'terminal' ? Math.floor(t / 100) % 2 : 0;
  const sub = a.data.isSub;
  const sc = sub ? 0.75 : 1;
  const X = x - 4 * sc, Y = y - 16 * sc;
  const p = (dx, dy, w, h, c) => px(X + dx * sc, Y + dy * sc, Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)), c);

  // 그림자
  ctx.globalAlpha = 0.25; px(x - 4, y - 1, 8, 2, '#000'); ctx.globalAlpha = 1;
  // 다리
  p(2, 12, 2, 4 - step, '#2b2b3a'); p(5, 12, 2, 3 + step, '#2b2b3a');
  // 몸통
  p(1, 7, 7, 6, look.shirt);
  // 팔 (타이핑 시 위아래)
  p(0, 8 + bob, 1, 4, look.skin); p(8, 8 + (1 - bob), 1, 4, look.skin);
  // 머리
  p(2, 1, 5, 6, look.skin); p(1, 0, 7, 3, look.hair); p(1, 3, 1, 2, look.hair);
  p(3, 4, 1, 1, '#1d1d1d'); p(5, 4, 1, 1, '#1d1d1d');
  if (a.data.agent === 'codex') {
    // Codex: 검은 캡모자 + 가슴에 흰 로고
    p(0, -1, 9, 2, '#111318'); p(7, 1, 3, 1, '#111318'); p(4, 9, 1, 2, '#ffffff');
  } else {
    // Claude: 주황 배지
    p(3, 9, 2, 2, '#d97757');
  }
  // 들고 있는 물건
  if (st === 'reading') p(6, 8, 4, 5, '#f4efe1');
  if (st === 'idle' && !moving) p(8, 9, 2, 3, '#e8e8e8');

  // 말풍선
  const bubble = { thinking: '…', waiting: '!', idle: '☕', meeting: '💬', terminal: '>_', reading: '📖', browsing: '🌐' }[st];
  const sx = x * S, sy = (y - 16 * sc - 4) * S;
  if (bubble && !moving) {
    const pulse = st === 'waiting' ? 1 + Math.sin(t / 150) * 0.15 : 1;
    ctx.save(); ctx.translate(sx, sy - 14); ctx.scale(pulse, pulse);
    ctx.fillStyle = st === 'waiting' ? '#ff5c7a' : '#f4efe1';
    ctx.beginPath(); ctx.roundRect(-14, -12, 28, 20, 5); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-3, 8); ctx.lineTo(3, 8); ctx.lineTo(0, 13); ctx.fill();
    ctx.fillStyle = st === 'waiting' ? '#fff' : '#1b1d2a';
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(st === 'thinking' ? '.'.repeat(1 + (Math.floor(t / 400) % 3)) : bubble, 0, -2);
    ctx.restore();
  }
  // 이름표
  const name = a.data.title.length > 14 ? a.data.title.slice(0, 13) + '…' : a.data.title;
  ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const w = ctx.measureText(name).width + 8;
  ctx.fillStyle = '#000000a0'; ctx.fillRect(sx - w / 2, y * S + 2, w, 15);
  ctx.fillStyle = STATE_INFO[st]?.color || '#fff'; ctx.fillText(name, sx, y * S + 4);
}

// ---------- 루프 ----------
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawOffice(t);

  const list = [...agents.values()];
  const deskState = new Map(list.filter((a) => a.deskIndex != null).map((a) => [a.deskIndex, a]));
  DESKS.forEach((_, i) => {
    const a = deskState.get(i);
    const atDesk = a && !a.moving && !SPOTS[a.data.state];
    const st = atDesk ? a.data.state : null;
    drawDesk(i, st === 'waiting' ? '#5a2a35' : st === 'browsing' ? '#2a4a7a' : st ? '#1e3a2e' : null);
    if (st) drawScreenContent(i, st, t);
  });

  let idleRank = 0;
  list.forEach((a) => { a.spotRank = a.data.state === 'idle' ? idleRank++ : 0; });
  list.forEach((a, i) => {
    const tg = targetFor(a, i);
    const dx = tg.x - a.x, dy = tg.y - a.y, dist = Math.hypot(dx, dy);
    a.moving = dist > 1;
    if (a.moving) { const sp = Math.min(dist, 45 * dt); a.x += (dx / dist) * sp; a.y += (dy / dist) * sp; }
  });
  list.sort((p, q) => p.y - q.y).forEach((a) => drawAgent(a, t)); // 아래쪽이 앞에 보이도록

  if (!list.length) {
    ctx.fillStyle = '#ffffffb0'; ctx.font = '16px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center';
    ctx.fillText('최근 30분간 활동한 Claude Code 세션이 없어요', canvas.width / 2, canvas.height / 2);
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
      const h = hash(d.id);
      a = { x: 120, y: 148, deskIndex: null, moving: true,
            look: { shirt: d.agent === 'codex' ? ['#2d3340', '#3b4252', '#1f6f5c'][h % 3] : SHIRTS[h % SHIRTS.length], hair: HAIRS[(h >> 3) % HAIRS.length], skin: ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac'][(h >> 6) % 4] } };
      agents.set(d.id, a);
    }
    a.data = d;
  }
  assignDesks();
  renderList();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ago(ts) { if (!ts) return ''; const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? `${s}초 전` : `${Math.round(s / 60)}분 전`; }

function renderList() {
  const el = document.getElementById('list');
  if (!sessions.length) { el.innerHTML = '<div class="card empty">활동 중인 세션 없음</div>'; return; }
  el.innerHTML = sessions.map((s) => {
    const info = STATE_INFO[s.state] || STATE_INFO.working;
    const a = agents.get(s.id);
    return `<div class="card">
      <div class="top"><span class="dot" style="background:${a?.look.shirt}"></span>
        <span class="who ${s.agent}">${s.agent === 'codex' ? 'Codex' : 'Claude'}</span>
        <span class="name" title="${esc(s.title)}">${s.isSub ? '↳ ' : ''}${esc(s.title)}</span>
        <span class="badge" style="color:${info.color}">${info.label}</span></div>
      <div class="detail">${esc(s.detail || '')}</div>
      <div class="detail">${esc(s.project)} · 도구 ${s.tools}회 · ${ago(s.lastEvent)}</div>
      ${s.log.length ? `<ul class="log">${s.log.slice().reverse().map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
}
setInterval(renderList, 5000);

const conn = document.getElementById('conn');
const es = new EventSource('/events');
es.onopen = () => { conn.textContent = '● 실시간 연결됨'; conn.style.color = '#7bd88f'; };
es.onerror = () => { conn.textContent = '○ 재연결 중…'; conn.style.color = '#ff5c7a'; };
es.onmessage = (e) => sync(JSON.parse(e.data));
