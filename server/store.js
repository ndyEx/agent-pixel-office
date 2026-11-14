// 저장소: 계정·로그인 토큰·채팅·직접 그린 캐릭터를 SQLite 파일 하나(data/office.db)에 저장한다.
// 비밀번호는 scrypt 해시로만 보관한다 (auth.js).
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, key TEXT NOT NULL REFERENCES users(key), exp INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, room TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, t INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS messages_room_t ON messages(room, t);
`;

/**
 * @param {string} file  DB 파일 경로 (테스트는 ':memory:')
 * @param {string|null} dataDir  예전 JSON 데이터가 있는지 볼 폴더
 */
function openStore(file, dataDir) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  // 직접 그린 도트 캐릭터(JSON). 예전 DB에는 칸이 없으므로 없을 때만 추가
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');

  const q = {
    getUser: db.prepare('SELECT * FROM users WHERE key = ?'),
    addUser: db.prepare('INSERT INTO users (key, name, salt, hash, created) VALUES (?, ?, ?, ?, ?)'),
    getSession: db.prepare('SELECT s.key, u.name FROM sessions s JOIN users u ON u.key = s.key WHERE s.token = ? AND s.exp > ?'),
    addSession: db.prepare('INSERT OR IGNORE INTO sessions (token, key, exp) VALUES (?, ?, ?)'),
    delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE exp <= ?'),
    addMessage: db.prepare('INSERT INTO messages (id, room, name, text, t) VALUES (@id, @room, @name, @text, @t)'),
    recent: db.prepare('SELECT * FROM (SELECT * FROM messages WHERE room = ? ORDER BY t DESC LIMIT 100) ORDER BY t'),
    clearRoom: db.prepare('DELETE FROM messages WHERE room = ?'),
    setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE key = ?'),
    allAvatars: db.prepare('SELECT name, avatar FROM users WHERE avatar IS NOT NULL'),
  };

  if (dataDir) migrateJson(db, q, dataDir);

  // 이름 → 직접 그린 캐릭터
  const avatarMap = () => Object.fromEntries(q.allAvatars.all()
    .map((r) => { try { return [r.name, JSON.parse(r.avatar)]; } catch { return null; } }).filter(Boolean));

  return { db, q, avatarMap };
}

// 이전 버전의 JSON 파일(users.json, sessions.json)이 있으면 한 번만 옮겨 담는다
function migrateJson(db, q, dataDir) {
  const usersFile = path.join(dataDir, 'users.json'), tokensFile = path.join(dataDir, 'sessions.json');
  if (!fs.existsSync(usersFile)) return;
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  db.transaction(() => {
    for (const [key, u] of Object.entries(read(usersFile)))
      if (!q.getUser.get(key)) q.addUser.run(key, u.name, u.salt, u.hash, u.created || Date.now());
    for (const [tok, s] of Object.entries(read(tokensFile)))
      if (q.getUser.get(s.key) && s.exp > Date.now()) q.addSession.run(tok, s.key, s.exp);
  })();
  for (const f of [usersFile, tokensFile]) if (fs.existsSync(f)) fs.renameSync(f, f + '.migrated');
  console.log('JSON 계정 데이터를 SQLite로 옮김');
}

module.exports = { openStore };
