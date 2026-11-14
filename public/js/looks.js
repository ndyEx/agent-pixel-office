// 캐릭터 외모: 이름·세션 id로 정해지는 기본 모습과, 사용자가 직접 그린 캐릭터.
import { hash } from './util.js';

const SHIRTS = ['#e06c75', '#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#ff9e64', '#f7768e'];
const CODEX_SHIRTS = ['#2d3340', '#3b4252', '#1f6f5c'];
const HAIRS = ['#3b2a20', '#1d1d1d', '#a0522d', '#d8b45c', '#6b4f3a', '#8a8a8a'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac'];
const PANTS = ['#2f3a5a', '#3b3b46', '#4a3a2e', '#2e4a3e', '#4a3f5e'];
// Claude 세션 머리띠 색. 흰색 계열은 Codex 칩(흰색)과 헷갈리므로 뺀다
const BANDS = ['#61afef', '#98c379', '#c678dd', '#e5c07b', '#56b6c2', '#f7768e', '#9ece6a', '#7aa2f7'];

/** 같은 seed면 늘 같은 모습 */
export function lookFor(seed, shirts = SHIRTS) {
  const h = hash(seed);
  return { shirt: shirts[h % shirts.length], hair: HAIRS[(h >> 3) % HAIRS.length], skin: SKINS[(h >> 6) % 4], pants: PANTS[(h >> 9) % PANTS.length] };
}

/** 에이전트 모습. Claude는 세션마다 다른 머리띠 색(band)을 달아 목록 카드·이름표 칩과 짝을 맞춘다 */
export function agentLook(id, agent) {
  const look = lookFor(id, agent === 'codex' ? CODEX_SHIRTS : SHIRTS);
  if (agent === 'claude') look.band = BANDS[hash(id) % BANDS.length];
  return look;
}

// ---------- 직접 그린 캐릭터 ----------
// 이름 → avatar (서버가 접속 때 전부, 바뀔 때마다 하나씩 보내 줌). 형식은 server/avatar.js 참고
export const avatars = new Map();
export function setAvatar(name, av) {
  if (av) avatars.set(name, { ...av, _key: hash(JSON.stringify(av)) }); else avatars.delete(name);
}

/** 사람 모습: 직접 그린 게 있으면 그것, 없으면 이름으로 정해지는 기본 모습 */
export function humanLook(name) {
  const base = lookFor(name), av = avatars.get(name);
  return av ? { ...base, custom: av, customKey: av._key } : base;
}
