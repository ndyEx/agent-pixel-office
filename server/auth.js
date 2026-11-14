// 로그인: 비밀번호 해시, 로그인 쿠키(po_session), 그리고 훅 요청용 비밀값.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 로그인 유지 30일
const COOKIE = 'po_session';

const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

function checkPassword(user, pw) {
  const a = Buffer.from(hashPassword(pw, user.salt), 'hex'), b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 길이가 달라도 예외 없이 비교하는 비밀값 비교 (시간 차로 값을 알아내지 못하게) */
function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
    catch { /* 깨진 쿠키는 무시하고 접속은 받는다 */ }
  }
  return out;
}

/** 저장소(q)를 쓰는 로그인 기능 묶음 */
function createAuth(q) {
  return {
    /** 쿠키 헤더 → 로그인 사용자 { key, name, token } 또는 null */
    userFromCookie(header) {
      const token = parseCookies(header)[COOKIE];
      const row = token && q.getSession.get(token, Date.now());
      return row ? { key: row.key, name: row.name, token } : null;
    },
    /** 아직 유효한 로그인 토큰인가 */
    isValid(token) {
      return !!q.getSession.get(token, Date.now());
    },
    /** 새 로그인 토큰을 만들어 쿠키로 심는다 */
    issueToken(res, key) {
      const token = crypto.randomBytes(24).toString('hex');
      q.purgeSessions.run(Date.now());
      q.addSession.run(token, key, Date.now() + TOKEN_TTL_MS);
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}`);
    },
    revoke(res, token) {
      if (token) q.delSession.run(token);
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    },
  };
}

// 훅 요청은 data/hook-token 의 비밀값을 함께 보내야 받는다 (외부 공개 시 아무나 상태를 조작하지 못하게).
// 처음 실행할 때 만들어 두고, hooks/claude-hook.sh 가 같은 파일을 읽는다.
function loadHookToken(dataDir) {
  const file = path.join(dataDir, 'hook-token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t; } catch { /* 처음 실행 */ }
  const t = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(file, t + '\n', { mode: 0o600 }); } catch { /* 저장 못 해도 이번 실행에서는 동작 */ }
  return t;
}

module.exports = { createAuth, hashPassword, checkPassword, sameSecret, loadHookToken };
