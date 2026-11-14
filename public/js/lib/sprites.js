// 캐릭터 도트 스프라이트
// 문자열 도트맵(한 글자 = 한 픽셀)을 팔레트로 칠하고, 조합마다 오프스크린 캔버스에 캐시한다.
// 방향: down(정면) / up(뒷모습) / side(오른쪽, 왼쪽은 그릴 때 좌우 반전)
// 프레임: 걷기 4단계(서기 → 왼발 → 서기 → 오른발), 눈 깜빡임, 타이핑 팔 움직임
export const Sprites = (function () {
  const PX = 4;          // 도트 1개 = 화면 4px (월드 1칸과 같음)
  const W = 10, H = 17;  // 스프라이트 크기 (도트)

  // o 외곽선  h/H 머리(밝은 부분)  s 피부  r 볼  e 눈  c/C 옷(그림자)  b 칼라·배지
  // p/P 바지(그림자)  f 신발  k/K 캡모자  w 로고
  const HEAD = {
    down: [
      '..oooooo..',
      '.ohhHHhho.',
      'ohhhhhhhho',
      'ohssssssho',
      'ossessesso',
      'osrssssrso',
      '.osssssso.',
    ],
    up: [
      '..oooooo..',
      '.ohhhhhho.',
      'ohhhhhhhho',
      'ohhhHHhhho',
      'ohhhhhhhho',
      'oshhhhhhso',
      '.osssssso.',
    ],
    side: [
      '..oooooo..',
      '.ohhHHhho.',
      'ohhhhhhhho',
      'ohhhhsssso',
      'ohhhssseso',
      'ohhsssssro',
      '.ohssssso.',
    ],
  };

  // Codex: 검은 캡모자 (머리 윗줄을 덮어씀)
  const CAP = {
    down: { 1: '.okkwwkko.', 2: 'okkkkkkkko', 3: 'oKKKKKKKKo' },
    up:   { 1: '.okkkkkko.', 2: 'okkkkkkkko', 3: 'okkkkkkkko', 4: 'ohhKKKKhho' },
    side: { 1: '.okkkkkko.', 2: 'okkkkkkkko', 3: 'okkkKKKKKK' },
  };

  const BODY = {
    down: [
      '.occbbcco.',
      'oCccccccCo',
      'oCccccccCo',
      'osCCCCCCso',
      '.oppppppo.',
    ],
    up: [
      '.occcccco.',
      'oCccccccCo',
      'oCccccccCo',
      'osCCCCCCso',
      '.oppppppo.',
    ],
    // 뒷모습 타이핑: 손이 한 줄 올라감
    upType: [
      '.occcccco.',
      'oCccccccCo',
      'osccccccso',
      'oCCCCCCCCo',
      '.oppppppo.',
    ],
    side: [
      '.occcccco.',
      '.occCCcco.',
      '.occCCcco.',
      '.oCCssCCo.',
      '.oppppppo.',
    ],
  };

  const STAND_FB = ['.oppooppo.', '.oppooppo.', '.oPPooPPo.', '.offooffo.', '..oo..oo..'];
  const STAND_SIDE = ['..oppppo..', '..oppppo..', '..oPPPPo..', '..offfffo.', '..ooooooo.'];
  const LEGS = {
    fb: [
      STAND_FB,
      ['.oppooppo.', '.oppooppo.', '.oPPooffo.', '.offo.oo..', '..oo......'],
      STAND_FB,
      ['.oppooppo.', '.oppooppo.', '.offooPPo.', '..oo.offo.', '......oo..'],
    ],
    side: [
      STAND_SIDE,
      ['..oppppo..', '.opppoppo.', '.oPPo.oPPo', 'offo..offo', '.oo....oo.'],
      STAND_SIDE,
      ['..oppppo..', '..opppppo.', '..oPPoPPo.', '..offoffo.', '..oo.oo...'],
    ],
  };

  // 앉은 자세: 다리가 3줄로 짧아지고 몸 전체가 2줄 내려간다 (정면·뒷모습만)
  const SIT = {
    down: ['.oPPPPPPo.', '.offooffo.', '..oo..oo..'],
    up:   ['.oPPPPPPo.', '..........', '..........'], // 뒷모습은 의자 등받이가 가린다
  };
  const BLANK = '..........';

  // ---------- Claude: Claude Code 시작 화면의 주황색 픽셀 캐릭터 ----------
  // 네모난 몸, 세로로 긴 두 눈, 양옆으로 뻗은 팔, 아래에 다리 넷(둘·틈·둘)
  // o 외곽선  c/C 몸(그림자)  L 윗면 하이라이트  e 눈
  const CW = 11, CH = 12;
  const plain = '.o' + 'ccccccc' + 'o.';
  const eyes2 = '.o' + 'c' + 'e' + 'ccc' + 'e' + 'c' + 'o.';   // 정면: 두 눈
  const eye1 = '.o' + 'ccccc' + 'e' + 'c' + 'o.';              // 옆모습: 앞쪽 눈 하나
  const armsA = ['o' + 'ccccccccc' + 'o', 'o' + 'CC' + 'ccccc' + 'CC' + 'o'];
  const armsB = ['o' + 'CC' + 'ccccc' + 'CC' + 'o', 'o' + 'ccccccccc' + 'o']; // 타이핑: 팔 들썩
  // band: 세션마다 다른 색 머리띠(B)로 여러 Claude를 구분. 옆모습·뒷모습에선 매듭(K)이 보임
  function clawdTop(dir, type, band) {
    const eye = dir === 'down' ? eyes2 : dir === 'side' ? eye1 : plain;
    const arms = type ? armsB : armsA;
    const head = !band ? '.o' + 'LLLLLLL' + 'o.'
      : dir === 'side' ? 'Ko' + 'BBBBBBB' + 'o.'
      : dir === 'up' ? '.o' + 'BBBKBBB' + 'o.'
      : '.o' + 'BBBBBBB' + 'o.';
    return [
      '..' + 'ooooooo' + '..',
      head,
      plain, eye, eye,
      ...arms,
      'oo' + 'ccccccc' + 'oo',
      '.o' + 'CCCCCCC' + 'o.',
    ];
  }
  const CLAWD_LEGS = [
    ['..C.C.C.C..', '..o.o.o.o..', '...........'],
    ['..C.C.C.C..', '..C.o.C.o..', '..o...o....'],
    ['..C.C.C.C..', '..o.o.o.o..', '...........'],
    ['..C.C.C.C..', '..o.C.o.C..', '....o...o..'],
  ];
  const CLAWD_BLANK = '...........';

  // 도트맵 줄 길이 검사 (잘못 그린 줄이 있으면 콘솔에 알림)
  const all = [...Object.values(HEAD), ...Object.values(BODY), ...LEGS.fb, ...LEGS.side, ...Object.values(SIT),
    ...Object.values(CAP).map((o) => Object.values(o))].flat();
  for (const row of all) if (row.length !== W || /[^.a-zA-Z]/.test(row)) console.warn('sprite row', row.length, row);
  const clawdAll = [...['down', 'up', 'side'].flatMap((d) => [...clawdTop(d, false), ...clawdTop(d, true, true)]), ...CLAWD_LEGS.flat()];
  for (const row of clawdAll) if (row.length !== CW || /[^.a-zA-Z]/.test(row)) console.warn('clawd row', row.length, row);

  // ---------- 색 ----------
  const toRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function shade(hex, amt) {
    const [r, g, b] = toRgb(hex);
    return amt < 0 ? toHex(r * (1 + amt), g * (1 + amt), b * (1 + amt))
      : toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  }
  function mix(a, b, k) { const x = toRgb(a), y = toRgb(b); return toHex(...x.map((v, i) => v + (y[i] - v) * k)); }

  const BADGE = { claude: '#d97757', codex: '#e8e8e8', human: '#f4efe1' };

  function palette(look, kind, blink) {
    return {
      o: '#1a1b26',
      h: look.hair, H: shade(look.hair, 0.3),
      s: look.skin, r: mix(look.skin, '#ff6b6b', 0.3),
      e: blink ? shade(look.skin, -0.3) : '#1d1d1d',
      c: look.shirt, C: shade(look.shirt, -0.25),
      b: BADGE[kind] || BADGE.human,
      p: look.pants, P: shade(look.pants, -0.3),
      f: '#2a2230',
      k: '#1c1f27', K: '#0d0e12', w: '#ffffff',
    };
  }

  const cache = new Map();

  /**
   * @param look { shirt, hair, skin, pants }
   * @param o { kind: 'claude'|'codex'|'human', dir: 'down'|'up'|'left'|'right', frame: 0~3, blink, type, sit }
   * @returns 오른쪽/정면 기준 캔버스 (왼쪽은 호출하는 쪽에서 반전)
   */
  function paintInto(g, rows, pal, yOff = 0) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(x * PX, (y + yOff) * PX, PX, PX);
      }
    });
  }
  function paint(rows, pal, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w * PX; cv.height = h * PX;
    paintInto(cv.getContext('2d'), rows, pal);
    return cv;
  }

  // ---------- 직접 그린 캐릭터 ----------
  // custom = { palette: ['#rrggbb'...], pants, views: { down|up|side: 12줄 x 10칸, '.' 또는 '0'~'f' } }
  // 사용자가 그린 머리·몸 12줄 아래에 바지 색으로 다리를 붙여서, 걷기·앉기 애니메이션은 기본 캐릭터와 같게 움직인다
  function getCustom(cu, key, dir, frame, sit) {
    let cv = cache.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = W * PX; cv.height = H * PX;
    const g = cv.getContext('2d');
    const pal = Object.fromEntries(cu.palette.map((c, i) => [i.toString(16), c]));
    const legPal = { o: '#1a1b26', p: cu.pants, P: shade(cu.pants, -0.3), f: '#2a2230' };
    const y0 = sit ? 2 : 0;
    paintInto(g, cu.views[dir], pal, y0);
    paintInto(g, sit ? SIT[dir] : LEGS[dir === 'side' ? 'side' : 'fb'][frame], legPal, y0 + 12);
    cache.set(key, cv);
    return cv;
  }

  // 기본 캐릭터의 머리·몸 12줄을 색(또는 null) 배열로: 편집기가 처음 그림으로 채워 넣을 때 쓴다
  function baseRows(look, dir) {
    const pal = palette(look, 'human', false);
    return [...HEAD[dir], ...BODY[dir]].map((row) => [...row].map((ch) => pal[ch] || null));
  }

  const CLAWD_PAL = { o: '#5a2a1c', c: '#d97757', C: '#b35a3e', L: '#eb9c80', e: '#1a1b26' };

  function get(look, o) {
    const dir = o.dir === 'left' || o.dir === 'right' ? 'side' : o.dir;
    const sit = !!o.sit && dir !== 'side';
    const frame = sit ? 0 : o.frame % 4;

    if (o.kind === 'claude') { // Claude 캐릭터는 옷·머리 색과 상관없이 모두 같은 모습
      const type = !!o.type, band = look.band || null;
      const key = ['clawd', band, dir, frame, !!o.blink, type, sit].join('|');
      let cv = cache.get(key);
      if (cv) return cv;
      const top = clawdTop(dir, type, band);
      const rows = sit ? [CLAWD_BLANK, CLAWD_BLANK, ...top, CLAWD_BLANK] : [...top, ...CLAWD_LEGS[frame]];
      const pal = { ...CLAWD_PAL, e: o.blink ? CLAWD_PAL.c : CLAWD_PAL.e };
      if (band) { pal.B = band; pal.K = shade(band, -0.3); }
      cv = paint(rows, pal, CW, CH);
      cache.set(key, cv);
      return cv;
    }

    if (look.custom && o.kind === 'human') return getCustom(look.custom, ['custom', look.customKey, dir, frame, sit].join('|'), dir, frame, sit);

    const type = !!o.type && dir === 'up';
    const key = [look.shirt, look.hair, look.skin, look.pants, o.kind, dir, frame, !!o.blink, type, sit].join('|');
    let cv = cache.get(key);
    if (cv) return cv;

    const head = HEAD[dir].slice();
    if (o.kind === 'codex') for (const [i, row] of Object.entries(CAP[dir])) head[i] = row;
    const body = type ? BODY.upType : BODY[dir];
    const rows = sit
      ? [BLANK, BLANK, ...head, ...body, ...SIT[dir]]
      : [...head, ...body, ...LEGS[dir === 'side' ? 'side' : 'fb'][frame]];
    cv = paint(rows, palette(look, o.kind, o.blink), W, H);
    cache.set(key, cv);
    return cv;
  }

  // 소품을 쥘 손 위치(도트 좌표): hand = 평소, sip = 마실 때 입 앞
  const LAYOUT = {
    human:  { hand: { down: { x: 8, y: 10 }, side: { x: 6, y: 10 } }, sip: { down: { x: 6, y: 5 }, side: { x: 8, y: 5 } } },
    claude: { hand: { down: { x: 9, y: 5 }, side: { x: 8, y: 5 } }, sip: { down: { x: 4.5, y: 4 }, side: { x: 9, y: 3 } } },
  };
  const layout = (kind) => (kind === 'claude' ? LAYOUT.claude : LAYOUT.human);

  return { W, H, PX, get, shade, mix, layout, baseRows };
})();
