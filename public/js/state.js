// 화면 전체가 함께 쓰는 상태. 여러 모듈이 읽고 쓰므로 한곳에 모아 둔다.
// (다른 모듈의 let 변수는 바깥에서 바꿀 수 없어서, 바뀌는 값은 state 객체의 속성으로 둔다)
import { ROOMS } from './world.js';

export const state = {
  /** 로그인한 나: { name, room, x, y, placed, moving, dir, act, still } 또는 null */
  me: null,
  /** 지금 화면에 보이는 방. 로그인 전에는 탭으로 고른 방, 로그인 후에는 내가 있는 방 */
  viewRoom: 'office',
  /** socket.io 연결 (connection.js) */
  socket: null,
  /** 서버가 보낸 에이전트 목록 (공개 데이터, 서버의 server/agents/session.js toPublic) */
  sessions: [],
  /** 서버가 보낸 일일 통계 (회의실 화이트보드 + 통계 카드) */
  statsSnap: null,
};

/** 에이전트 캐릭터: 공개 id → { data, x, y, deskIndex, look, band, seed, moving, dir, spotRank } */
export const agents = new Map();

/** 사람 캐릭터: 이름 → { name, room, x, y, tx, ty, look, act, say, sayAt, moving, dir } */
export const people = new Map();

/** 방별 채팅 기록과 안 읽은 수 */
export const chats = Object.fromEntries(ROOMS.map((r) => [r.id, []]));
export const unread = Object.fromEntries(ROOMS.map((r) => [r.id, 0]));
