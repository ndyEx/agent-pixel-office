// HTTP 요청 처리: /api/* (로그인·캐릭터·훅) 와 public/ 정적 파일.
// 쿠키를 심어야 하는 로그인만 HTTP로 받고, 이동·채팅 같은 실시간 동작은 socket.io(realtime.js)로 받는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, checkPassword, sameSecret } = require('./auth');
const { cleanAvatar } = require('./avatar');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const NAME_RULE = /^[\w가-힣]{2,16}$/;

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const isJson = (req) => /^application\/json/.test(req.headers['content-type'] || '');

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/**
 * @param {object} deps
 * @param {string} deps.publicDir
 * @param {object} deps.store   { q }
 * @param {object} deps.auth    createAuth()
 * @param {string} deps.hookToken
 * @param {(body:object)=>boolean} deps.onHook        훅 이벤트 반영
 * @param {(name:string, avatar:object|null)=>void} deps.onAvatarChanged
 * @param {(token:string)=>void} deps.onLogout        그 토큰으로 연결된 실시간 연결을 끊는다
 */
function createHttpHandler({ publicDir, store, auth, hookToken, onHook, onAvatarChanged, onLogout }) {
  const { q } = store;

  async function handleApi(req, res, pathname) {
    // Claude Code 훅 (hooks/claude-hook.sh). 로그인 대신 비밀값으로 확인한다.
    if (pathname === '/api/hook') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST만 가능' });
      if (!sameSecret(req.headers['x-hook-token'] || '', hookToken)) return json(res, 403, { error: '훅 토큰이 맞지 않아요' });
      let body;
      try { body = await readJson(req, 1024 * 1024); } catch { return json(res, 400, { error: '잘못된 요청' }); }
      return json(res, 200, { ok: onHook(body) });
    }

    const user = auth.userFromCookie(req.headers.cookie);
    if (pathname === '/api/me') return json(res, 200, { name: user ? user.name : null });

    if (pathname === '/api/avatar' && req.method === 'POST') {
      if (!user) return json(res, 401, { error: '로그인이 필요해요' });
      if (!isJson(req)) return json(res, 415, { error: 'JSON만 가능' });
      let avatar;
      try { avatar = cleanAvatar((await readJson(req, 8192)).avatar); } catch { return json(res, 400, { error: '캐릭터 데이터가 올바르지 않아요' }); }
      q.setAvatar.run(avatar ? JSON.stringify(avatar) : null, user.key);
      onAvatarChanged(user.name, avatar);
      return json(res, 200, { ok: true });
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'POST만 가능' });
    // JSON 본문만 받는다 (다른 사이트의 폼 전송으로 요청을 위조하는 것을 막음)
    if (!isJson(req)) return json(res, 415, { error: 'JSON만 가능' });
    const body = await readJson(req);

    if (pathname === '/api/signup' || pathname === '/api/login') {
      const name = String(body.username || '').trim();
      const pw = String(body.password || '');
      const key = name.toLowerCase();
      let u = q.getUser.get(key);
      if (pathname === '/api/signup') {
        if (!NAME_RULE.test(name)) return json(res, 400, { error: '이름은 2~16자 한글·영문·숫자·_ 만 가능해요' });
        if (pw.length < 4 || pw.length > 128) return json(res, 400, { error: '비밀번호는 4자 이상이어야 해요' });
        if (u) return json(res, 409, { error: '이미 있는 이름이에요' });
        const salt = crypto.randomBytes(16).toString('hex');
        q.addUser.run(key, name, salt, hashPassword(pw, salt), Date.now());
        u = q.getUser.get(key);
      } else if (!u || !checkPassword(u, pw)) {
        return json(res, 401, { error: '이름 또는 비밀번호가 틀렸어요' });
      }
      auth.issueToken(res, key);
      return json(res, 200, { name: u.name });
    }

    if (pathname === '/api/logout') {
      auth.revoke(res, user?.token);      // 먼저 토큰을 지워야 끊긴 탭이 다시 붙어도 로그아웃 상태
      if (user) onLogout(user.token);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  // public/ 아래 파일만 보낸다 (경로에 .. 같은 것은 막음)
  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(rel) || rel.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(404); return res.end();
    }
    const file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep)) { res.writeHead(404); return res.end(); }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      const type = MIME[path.extname(file)] || 'text/plain';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(body);
    });
  }

  return (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch(() => { if (!res.headersSent) json(res, 400, { error: '잘못된 요청' }); });
      return;
    }
    serveStatic(res, pathname);
  };
}

module.exports = { createHttpHandler };
