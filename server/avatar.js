// 사용자가 직접 그린 도트 캐릭터 데이터 검사.
// 형식: { v: 1, palette: ['#rrggbb' x 최대 16], pants: '#rrggbb', views: { down|up|side: 12줄 x 10칸 } }
// 칸 글자: '.' = 빈칸, '0'~'f' = palette 번호. 머리·몸(12줄)만 그리고 다리는 바지 색으로 자동 생성한다.
// 브라우저 쪽 편집기는 public/js/lib/avatar-editor.js
const AV_ROWS = 12, AV_COLS = 10;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 올바르면 정리한 값을, 아니면 예외를 던진다. null은 '기본 모습으로 되돌리기' */
function cleanAvatar(a) {
  if (a === null) return null;
  if (!a || typeof a !== 'object' || !Array.isArray(a.palette) || !a.views) throw new Error('bad avatar');
  const palette = a.palette.slice(0, 16).map(String);
  if (!palette.length || !palette.every((c) => HEX_COLOR.test(c))) throw new Error('bad palette');
  if (!HEX_COLOR.test(String(a.pants))) throw new Error('bad pants');
  const cell = new RegExp(`^[.${'0123456789abcdef'.slice(0, palette.length)}]{${AV_COLS}}$`);
  const views = {};
  for (const dir of ['down', 'up', 'side']) {
    const rows = a.views[dir];
    if (!Array.isArray(rows) || rows.length !== AV_ROWS || !rows.every((r) => typeof r === 'string' && cell.test(r))) throw new Error(`bad view ${dir}`);
    views[dir] = rows;
  }
  return { v: 1, palette: palette.map((c) => c.toLowerCase()), pants: String(a.pants).toLowerCase(), views };
}

module.exports = { cleanAvatar };
