// 내 도트 캐릭터 편집기
// 정면·뒷모습·옆모습의 머리·몸(10x12칸)을 한 칸씩 칠한다. 다리는 바지 색으로 자동으로 붙어 걷기·앉기가 그대로 움직인다.
// 저장 형식은 server.js의 cleanAvatar와 같다: { v, palette: [최대 16색], pants, views: { down|up|side: 12줄 } }
(function () {
  const COLS = 10, ROWS = 12, LEG_ROWS = 5, CELL = 22;
  const DIRS = [['down', '정면'], ['up', '뒷모습'], ['side', '옆모습(→)']];
  const BASIC = ['#1a1b26', '#ffffff', '#f1c27d', '#e0ac69', '#c68642', '#3b2a20', '#d8b45c', '#a0522d',
    '#e06c75', '#f5c26b', '#98c379', '#56b6c2', '#61afef', '#c678dd', '#ff9e64', '#8a8fa3'];

  let st = null; // 열려 있는 동안의 상태

  // ---------- 무작위 캐릭터 ----------
  // 기본 캐릭터 도트(Sprites.baseRows)를 랜덤 색으로 만든 뒤, 머리 모양·소품을 세 방향에 맞춰 덧칠한다.
  // 칸 위치는 sprites.js의 HEAD(0~6줄)·BODY(7~11줄) 도트맵 기준
  const R = {
    shirt: ['#e06c75', '#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#ff9e64', '#f7768e', '#7aa2f7', '#9ece6a', '#f4efe1', '#3b4252'],
    hair: ['#3b2a20', '#1d1d1d', '#a0522d', '#d8b45c', '#6b4f3a', '#8a8a8a', '#e06c75', '#61afef', '#c678dd', '#f4efe1'],
    skin: ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'],
    pants: ['#2f3a5a', '#3b3b46', '#4a3a2e', '#2e4a3e', '#4a3f5e', '#1d1d1d', '#6b4f3a', '#56b6c2'],
    acc: ['#e06c75', '#61afef', '#98c379', '#f5c26b', '#c678dd', '#1d1d1d', '#f4efe1', '#ff9e64'],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const chance = (p) => Math.random() < p;

  function randomCharacter() {
    const look = { shirt: pick(R.shirt), hair: pick(R.hair), skin: pick(R.skin), pants: pick(R.pants) };
    const shade = Sprites.shade;
    const shirtCells = new Set([look.shirt, shade(look.shirt, -0.25)]);
    const hat = chance(0.3) && pick(R.acc.filter((c) => c !== look.shirt));
    const opt = {
      long: chance(0.35), hat,
      band: !hat && chance(0.2) && pick(R.acc),
      glasses: chance(0.25),
      tie: chance(0.3) && pick(R.acc.filter((c) => c !== look.shirt)),
      stripe: chance(0.3) && shade(look.shirt, 0.4),
    };
    const views = {};
    for (const [dir] of DIRS) {
      const g = Sprites.baseRows(look, dir);
      const set = (x, y, c) => { if (y >= 0 && y < ROWS && x >= 0 && x < COLS) g[y][x] = c; };
      const span = (y, x0, x1, c) => { for (let x = x0; x <= x1; x++) set(x, y, c); };
      if (opt.long) { // 긴 머리: 얼굴 옆·목 뒤로 머리카락이 내려온다
        if (dir === 'down') for (let y = 3; y <= 7; y++) { set(1, y, look.hair); set(8, y, look.hair); }
        if (dir === 'up') { span(5, 1, 8, look.hair); span(6, 1, 8, look.hair); span(7, 2, 7, look.hair); }
        if (dir === 'side') { for (let y = 3; y <= 6; y++) span(y, 1, 3, look.hair); span(7, 1, 2, look.hair); }
      }
      if (opt.hat) { // 모자: 정수리 두 줄 + (정면·옆) 챙
        span(1, 1, 8, opt.hat);
        if (dir === 'up') span(2, 1, 8, opt.hat);
        else span(2, dir === 'side' ? 1 : 0, 9, shade(opt.hat, -0.3));
      }
      if (opt.band) span(2, 1, 8, opt.band); // 머리띠
      if (opt.stripe) for (let x = 0; x < COLS; x++) if (shirtCells.has(g[9][x])) g[9][x] = opt.stripe; // 줄무늬 옷
      if (opt.glasses) { // 안경: 테(검정) + 렌즈(하늘색)
        const fr = '#1a1b26', lens = '#bfe3ff';
        if (dir === 'down') { set(2, 4, fr); set(3, 4, lens); set(4, 4, fr); set(5, 4, fr); set(6, 4, lens); set(7, 4, fr); }
        if (dir === 'side') { set(6, 4, fr); set(7, 4, lens); set(8, 4, fr); }
      }
      if (opt.tie && dir === 'down') { span(8, 4, 5, opt.tie); span(9, 4, 5, opt.tie); span(10, 4, 5, shade(opt.tie, -0.3)); }
      views[dir] = g;
    }
    return { views, pants: look.pants };
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) n.append(kid);
    return n;
  };

  // 저장된 캐릭터(팔레트 번호) → 편집용 색 격자
  function fromAvatar(av) {
    const views = {};
    for (const [dir] of DIRS) views[dir] = av.views[dir].map((row) => [...row].map((ch) => (ch === '.' ? null : av.palette[parseInt(ch, 16)])));
    return { views, pants: av.pants };
  }
  // 편집용 색 격자 → 저장 형식 (쓰인 색만 팔레트로 모음)
  function toAvatar() {
    const palette = [];
    const idx = (c) => { let i = palette.indexOf(c); if (i < 0) { palette.push(c); i = palette.length - 1; } return i; };
    const views = {};
    for (const [dir] of DIRS) views[dir] = st.views[dir].map((row) => row.map((c) => (c ? idx(c).toString(16) : '.')).join(''));
    if (!palette.length) palette.push('#000000');
    return { v: 1, palette, pants: st.pants, views };
  }
  const usedColors = () => new Set(DIRS.flatMap(([d]) => st.views[d].flat().filter(Boolean)));

  // ---------- 그리기 ----------
  function drawGrid() {
    const g = st.grid.getContext('2d');
    const rows = st.views[st.dir];
    g.clearRect(0, 0, st.grid.width, st.grid.height);
    for (let y = 0; y < ROWS + LEG_ROWS; y++) for (let x = 0; x < COLS; x++) {
      g.fillStyle = (x + y) % 2 ? '#2b2f45' : '#323650'; // 빈칸 체크무늬
      g.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
    // 다리 미리보기 (편집 불가, 흐리게)
    const legs = Sprites.get({ shirt: '#000', hair: '#000', skin: '#000', pants: st.pants, custom: { palette: ['#000000'], pants: st.pants, views: { down: Array(ROWS).fill('.'.repeat(COLS)), up: Array(ROWS).fill('.'.repeat(COLS)), side: Array(ROWS).fill('.'.repeat(COLS)) } }, customKey: 'legs' + st.pants },
      { kind: 'human', dir: st.dir === 'side' ? 'right' : st.dir, frame: 0 });
    g.globalAlpha = 0.45;
    g.imageSmoothingEnabled = false;
    g.drawImage(legs, 0, ROWS * Sprites.PX, legs.width, LEG_ROWS * Sprites.PX, 0, ROWS * CELL, COLS * CELL, LEG_ROWS * CELL);
    g.globalAlpha = 1;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = rows[y][x];
      if (c) { g.fillStyle = c; g.fillRect(x * CELL, y * CELL, CELL, CELL); }
    }
    g.strokeStyle = '#ffffff14';
    for (let x = 0; x <= COLS; x++) { g.beginPath(); g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, (ROWS + LEG_ROWS) * CELL); g.stroke(); }
    for (let y = 0; y <= ROWS + LEG_ROWS; y++) { g.beginPath(); g.moveTo(0, y * CELL + 0.5); g.lineTo(COLS * CELL, y * CELL + 0.5); g.stroke(); }
    if (st.mirror && st.dir !== 'side') { g.strokeStyle = '#f5c26b88'; g.beginPath(); g.moveTo(COLS / 2 * CELL, 0); g.lineTo(COLS / 2 * CELL, ROWS * CELL); g.stroke(); }
    g.strokeStyle = '#f5c26b'; g.beginPath(); g.moveTo(0, ROWS * CELL + 0.5); g.lineTo(COLS * CELL, ROWS * CELL + 0.5); g.stroke();
  }

  // 미리보기: 정면 걷기 · 뒷모습 · 옆으로 걷기 · 앉기
  function drawPreview(t) {
    if (!st) return;
    const cv = st.preview, g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const look = { shirt: '#000', hair: '#000', skin: '#000', pants: st.pants, custom: st.avatar, customKey: 'edit' + st.version };
    const frame = Math.floor(t / 140) % 4;
    const shots = [['down', frame, false], ['up', frame, false], ['right', frame, false], ['left', frame, false], ['down', 0, true]];
    shots.forEach(([dir, fr, sit], i) => {
      const spr = Sprites.get(look, { kind: 'human', dir, frame: fr, sit });
      const x = 8 + i * 58, y = 8 + (fr % 2 === 0 && !sit ? -2 : 0);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + 20, 8 + 68 + 2, 16, 4, 0, 0, Math.PI * 2); g.fill();
      if (dir === 'left') { g.save(); g.translate(x + 40, y); g.scale(-1, 1); g.drawImage(spr, 0, 0); g.restore(); }
      else g.drawImage(spr, x, y);
    });
    st.raf = requestAnimationFrame(drawPreview);
  }

  function changed() {
    st.version++;
    st.avatar = toAvatar();
    drawGrid();
    const n = usedColors().size;
    st.count.textContent = `${n}/16색`;
    st.count.classList.toggle('over', n > 16);
  }

  function snapshot() { st.undo.push(JSON.stringify({ views: st.views, pants: st.pants })); if (st.undo.length > 60) st.undo.shift(); }

  function paintCell(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    const rows = st.views[st.dir];
    const c = st.tool === 'eraser' ? null : st.color;
    if (st.tool === 'fill') return fill(x, y, c);
    rows[y][x] = c;
    if (st.mirror && st.dir !== 'side') rows[y][COLS - 1 - x] = c;
  }
  function fill(x, y, c) {
    const rows = st.views[st.dir], from = rows[y][x];
    if (from === c) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS || rows[cy][cx] !== from) continue;
      rows[cy][cx] = c;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  function cellAt(e) {
    const r = st.grid.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / (r.width / COLS)), Math.floor((e.clientY - r.top) / (r.height / (ROWS + LEG_ROWS)))];
  }

  function renderSwatches() {
    const box = st.swatches;
    box.innerHTML = '';
    const colors = [...new Set([...usedColors(), ...BASIC, ...st.extra])];
    for (const c of colors) {
      box.append(el('button', { class: 'sw' + (c === st.color && st.tool !== 'eraser' ? ' on' : ''), style: `background:${c}`, title: c, type: 'button',
        onclick: () => { st.color = c; if (st.tool === 'eraser') setTool('pen'); renderSwatches(); } }));
    }
    const pick = el('input', { type: 'color', value: st.color, title: '다른 색 고르기' });
    pick.addEventListener('input', () => { st.color = pick.value; if (!st.extra.includes(pick.value)) st.extra.push(pick.value); if (st.tool === 'eraser') setTool('pen'); });
    pick.addEventListener('change', renderSwatches);
    box.append(el('label', { class: 'sw pick', title: '다른 색 고르기' }, '+', pick));
  }

  function setTool(t) {
    st.tool = t;
    st.root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    renderSwatches();
  }
  function setDir(d) {
    st.dir = d;
    st.root.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('on', b.dataset.dir === d));
    $('.mirror', st.root).style.visibility = d === 'side' ? 'hidden' : 'visible';
    drawGrid();
  }

  function close() {
    if (!st) return;
    cancelAnimationFrame(st.raf);
    st.root.remove();
    removeEventListener('keydown', st.onKey, true);
    st = null;
  }

  /**
   * @param base 기본 캐릭터 모습 { shirt, hair, skin, pants } — 아직 그린 적 없으면 이 모습에서 시작
   * @param current 저장된 캐릭터(없으면 null)
   * @param onSave async (avatar|null) => void   (null = 기본 캐릭터로 되돌리기)
   */
  function open({ base, current, onSave }) {
    close();
    const init = current ? fromAvatar(current)
      : { views: Object.fromEntries(DIRS.map(([d]) => [d, Sprites.baseRows(base, d)])), pants: base.pants };
    st = { ...init, dir: 'down', tool: 'pen', color: BASIC[8], mirror: true, extra: [], undo: [], version: 0, base };

    const grid = el('canvas', { class: 'av-grid', width: COLS * CELL, height: (ROWS + LEG_ROWS) * CELL });
    const preview = el('canvas', { class: 'av-preview', width: 5 * 58 + 8, height: 84 });
    const swatches = el('div', { class: 'av-swatches' });
    const count = el('span', { class: 'av-count' });
    const msg = el('div', { class: 'av-msg' });
    const pants = el('input', { type: 'color', value: st.pants });
    pants.addEventListener('input', () => { st.pants = pants.value; changed(); });
    pants.addEventListener('pointerdown', snapshot);
    const mirror = el('input', { type: 'checkbox' }); mirror.checked = true;
    mirror.addEventListener('change', () => { st.mirror = mirror.checked; drawGrid(); });

    const btn = (label, attrs, fn) => el('button', { type: 'button', class: 'btn ghost', ...attrs, onclick: fn }, label);
    const root = el('div', { class: 'av-modal', role: 'dialog', 'aria-label': '캐릭터 꾸미기' },
      el('div', { class: 'av-panel' },
        el('div', { class: 'av-head' }, el('b', {}, '🎨 내 캐릭터 꾸미기'), btn('✕', { class: 'btn ghost av-x', 'aria-label': '닫기' }, close)),
        el('div', { class: 'av-tabs' }, ...DIRS.map(([d, label]) => btn(label, { 'data-dir': d }, () => setDir(d))),
          el('span', { class: 'av-gap' }),
          btn('🎲 무작위', { class: 'btn av-dice', title: '세 방향을 한꺼번에 새 캐릭터로 (되돌리기 가능)' }, () => {
            snapshot();
            // 소품이 많이 겹치면 16색을 넘을 수 있으니 넘지 않을 때까지 다시 뽑는다
            let r;
            for (let i = 0; i < 30; i++) {
              r = randomCharacter();
              if (new Set(DIRS.flatMap(([d]) => r.views[d].flat().filter(Boolean))).size <= 16) break;
            }
            st.views = r.views; st.pants = r.pants; pants.value = r.pants;
            changed(); renderSwatches();
          })),
        el('div', { class: 'av-body' },
          el('div', { class: 'av-left' }, grid,
            el('div', { class: 'av-note' }, '노란 선 아래(다리)는 바지 색으로 자동으로 그려져요')),
          el('div', { class: 'av-right' },
            el('div', { class: 'av-tools' },
              btn('✏️ 펜', { 'data-tool': 'pen' }, () => setTool('pen')),
              btn('🧽 지우개', { 'data-tool': 'eraser' }, () => setTool('eraser')),
              btn('🪣 채우기', { 'data-tool': 'fill' }, () => setTool('fill')),
              btn('↩ 되돌리기', {}, () => { const s = st.undo.pop(); if (s) { Object.assign(st, JSON.parse(s)); pants.value = st.pants; changed(); renderSwatches(); } })),
            el('label', { class: 'mirror' }, mirror, ' 좌우 대칭으로 칠하기'),
            el('div', { class: 'av-sub' }, '색 ', count), swatches,
            el('label', { class: 'av-pants' }, '바지 색 ', pants),
            el('div', { class: 'av-sub' }, '미리보기'), preview,
            el('div', { class: 'av-row' },
              btn('이 방향 비우기', {}, () => { snapshot(); st.views[st.dir] = Array.from({ length: ROWS }, () => Array(COLS).fill(null)); changed(); }),
              btn('기본 모습에서 다시', {}, () => { snapshot(); st.views[st.dir] = Sprites.baseRows(st.base, st.dir); changed(); renderSwatches(); })))),
        msg,
        el('div', { class: 'av-foot' },
          current ? btn('기본 캐릭터로 되돌리기', {}, async () => { try { await onSave(null); close(); } catch (e) { msg.textContent = e.message; } }) : el('span'),
          el('span', { class: 'av-gap' }),
          btn('취소', {}, close),
          el('button', { type: 'button', class: 'btn', onclick: async () => {
            if (usedColors().size > 16) { msg.textContent = '색은 16가지까지 쓸 수 있어요'; return; }
            try { await onSave(toAvatar()); close(); } catch (e) { msg.textContent = e.message; }
          } }, '저장'))));
    Object.assign(st, { root, grid, preview, swatches, count });
    document.body.append(root);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); }); // 바깥 클릭 = 닫기

    // 격자에 끌어서 칠하기
    let drawing = false;
    grid.addEventListener('pointerdown', (e) => {
      e.preventDefault(); drawing = true; snapshot();
      try { grid.setPointerCapture(e.pointerId); } catch { /* 없어도 동작 */ }
      paintCell(...cellAt(e)); changed();
    });
    grid.addEventListener('pointermove', (e) => { if (drawing && st.tool !== 'fill') { paintCell(...cellAt(e)); changed(); } });
    for (const ev of ['pointerup', 'pointercancel']) grid.addEventListener(ev, () => { drawing = false; renderSwatches(); });

    // 편집기가 열린 동안 방향키·Enter가 캐릭터를 움직이지 않게, Esc = 닫기, Ctrl+Z = 되돌리기
    st.onKey = (e) => {
      if (e.key === 'Escape') { close(); e.stopPropagation(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('.av-tools button:last-child', root).click(); }
      if (!/^(INPUT)$/.test(e.target.tagName)) e.stopPropagation();
    };
    addEventListener('keydown', st.onKey, true);

    setDir('down'); setTool('pen'); changed();
    st.raf = requestAnimationFrame(drawPreview);
  }

  window.AvatarEditor = { open, close };
})();
