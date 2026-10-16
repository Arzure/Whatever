const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'game.db');
const fs = require('fs');
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// —— 表结构 ——
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS draw_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT NOT NULL,
  size TEXT NOT NULL,
  actual TEXT,
  prompt TEXT NOT NULL,
  file TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  bytes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_draw_history_user ON draw_history(user_id, created_at);
CREATE TABLE IF NOT EXISTS draw_prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT,
  UNIQUE(user_id, prompt)
);
CREATE TABLE IF NOT EXISTS saves (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'world',
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id, updated_at DESC);
`);
// 旧库迁移：draw_prompts 补充 source 字段（来源标记：draw 绘图 / office 办公）；旧记录视为绘图来源
try { db.exec("ALTER TABLE draw_prompts ADD COLUMN source TEXT DEFAULT 'draw'"); } catch { /* 字段已存在 */ }
// 旧库迁移：draw_history 补充 bytes 字段（文件大小，字节）；新库建表已含，重复执行会报错需忽略
try { db.exec('ALTER TABLE draw_history ADD COLUMN bytes INTEGER'); } catch { /* 字段已存在 */ }

// —— 密码哈希（scrypt，格式：salt:hash） ——
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// —— 用户 ——
function createUser(username, password) {
  const id = 'u_' + crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, username, hashPassword(password), now);
  return { id, username, createdAt: now };
}
function findUserByName(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// —— 存档（接口与旧版保持兼容，新增 userId 归属） ——
function saveGame(id, game, userId) {
  const now = Date.now();
  const existing = db.prepare('SELECT created_at FROM saves WHERE id = ?').get(id);
  const createdAt = existing ? existing.created_at : (game.createdAt || now);
  const row = JSON.stringify({ ...game, createdAt, updatedAt: now });
  if (existing) {
    db.prepare('UPDATE saves SET data = ?, mode = ?, updated_at = ? WHERE id = ?').run(row, game.mode || 'world', now, id);
  } else {
    db.prepare('INSERT INTO saves (id, user_id, mode, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, userId, game.mode || 'world', row, createdAt, now);
  }
}
function loadGame(id) {
  const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(id);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch (e) { return null; }
}
function getSaveOwner(id) {
  const row = db.prepare('SELECT user_id FROM saves WHERE id = ?').get(id);
  return row ? row.user_id : null;
}
function deleteGame(id) {
  db.prepare('DELETE FROM saves WHERE id = ?').run(id);
}
// 批量删除某用户名下全部存档（一键清空）；返回删除的条数
function deleteAllSaves(userId) {
  const info = db.prepare('DELETE FROM saves WHERE user_id = ?').run(userId);
  return info.changes;
}
function listSaves(userId) {
  const rows = userId
    ? db.prepare('SELECT data FROM saves WHERE user_id = ? ORDER BY updated_at DESC').all(userId)
    : db.prepare('SELECT data FROM saves ORDER BY updated_at DESC').all();
  const saves = [];
  for (const r of rows) {
    try {
      const data = JSON.parse(r.data);
      saves.push({
        id: data.id,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        playerName: data.player?.name || '无名冒险者',
        level: data.player?.level || 1,
        mode: data.mode || 'world',
        themeName: data.theme?.name || data.genre?.name || '',
        caseTitle: data.case?.title || '',
      });
    } catch (e) {
      // 忽略损坏的存档
    }
  }
  return saves;
}
function countSaves(userId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM saves WHERE user_id = ?').get(userId);
  return row ? row.c : 0;
}

// —— 账号管理 ——
function renameUser(userId, newName) {
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newName, userId);
}
function updatePassword(userId, newPassword) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
}
// —— 绘图历史（24 小时过期，图片存文件系统仅元数据入库） ——
const DRAW_TTL_MS = 24 * 60 * 60 * 1000;
function saveDrawHistory(userId, item) {
  db.prepare('INSERT OR REPLACE INTO draw_history (id, user_id, mode, model, size, actual, prompt, file, created_at, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    item.id, userId, item.mode, item.model, item.size, item.actual || null, item.prompt, item.file, Date.now(), item.bytes || null,
  );
}
function listDrawHistory(userId) {
  const cutoff = Date.now() - DRAW_TTL_MS;
  // 惰性清理：查询时顺带删除过期记录（文件由调用方清理）
  const expired = db.prepare('SELECT file FROM draw_history WHERE user_id = ? AND created_at < ?').all(userId, cutoff);
  db.prepare('DELETE FROM draw_history WHERE user_id = ? AND created_at < ?').run(userId, cutoff);
  return { rows: db.prepare('SELECT id, mode, model, size, actual, prompt, file, created_at, bytes FROM draw_history WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC').all(userId, cutoff), expired };
}
function deleteDrawHistory(userId, id) {
  const row = db.prepare('SELECT file FROM draw_history WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  db.prepare('DELETE FROM draw_history WHERE id = ? AND user_id = ?').run(id, userId);
  return row.file;
}
// —— 提示词历史（持续保留，UNIQUE 去重） ——
function saveDrawPrompt(userId, prompt, source) {
  db.prepare('INSERT OR IGNORE INTO draw_prompts (id, user_id, prompt, created_at, source) VALUES (?, ?, ?, ?, ?)').run(
    `${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, userId, prompt, Date.now(), source || 'draw',
  );
}
function listDrawPrompts(userId, source) {
  // 按来源过滤：绘图工作台只看 draw，办公助手只看 office；不传则返回全部（兼容）
  if (source) {
    return db.prepare('SELECT id, prompt, created_at FROM draw_prompts WHERE user_id = ? AND source = ? ORDER BY created_at DESC LIMIT 50').all(userId, source);
  }
  return db.prepare('SELECT id, prompt, created_at FROM draw_prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
}
function deleteDrawPrompt(userId, id) {
  db.prepare('DELETE FROM draw_prompts WHERE id = ? AND user_id = ?').run(id, userId);
}
function deleteUserCascade(userId) {
  // 事务：先删该用户全部存档，再删用户本身——要么全成功要么全回滚
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM saves WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
}

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  createUser,
  findUserByName,
  getUserById,
  renameUser,
  updatePassword,
  deleteUserCascade,
  saveGame,
  loadGame,
  getSaveOwner,
  deleteGame,
  deleteAllSaves,
  listSaves,
  countSaves,
  saveDrawHistory,
  listDrawHistory,
  deleteDrawHistory,
  saveDrawPrompt,
  listDrawPrompts,
  deleteDrawPrompt,
};
