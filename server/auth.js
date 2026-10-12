const crypto = require('crypto');
const { findUserByName, verifyPassword } = require('./storage');

// JWT 密钥：优先取环境变量，未配置时自动生成并写入 .env（重启不失效）
const fs = require('fs');
const path = require('path');
const ENV_PATH = path.join(__dirname, '..', '.env');
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let envText = '';
  try { envText = fs.readFileSync(ENV_PATH, 'utf-8'); } catch (e) {}
  const m = envText.match(/^JWT_SECRET=(.+)$/m);
  if (m) { process.env.JWT_SECRET = m[1].trim(); return process.env.JWT_SECRET; }
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.appendFileSync(ENV_PATH, `\nJWT_SECRET=${secret}\n`); } catch (e) {}
  process.env.JWT_SECRET = secret;
  return secret;
}
const JWT_SECRET = loadSecret();
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// —— JWT（HMAC-SHA256，无第三方依赖） ——
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJSON(obj) { return b64url(JSON.stringify(obj)); }
function sign(payload) {
  const header = b64urlJSON({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJSON(payload);
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expect = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

// —— 登录失败限速：5 次失败锁定 10 分钟（按用户名） ——
const loginAttempts = new Map(); // username -> { fails, lockedUntil }
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;
function checkLock(username) {
  const rec = loginAttempts.get(username);
  if (!rec) return false;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return true;
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) { loginAttempts.delete(username); return false; }
  return false;
}
function recordFail(username) {
  const rec = loginAttempts.get(username) || { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS) { rec.lockedUntil = Date.now() + LOCK_MS; rec.fails = 0; }
  loginAttempts.set(username, rec);
}
function clearFails(username) { loginAttempts.delete(username); }

// —— 登录校验 ——
function authenticate(username, password) {
  if (checkLock(username)) return { error: '失败次数过多，请 10 分钟后再试' };
  const user = findUserByName(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFail(username);
    return { error: '用户名或密码错误' };
  }
  clearFails(username);
  const now = Date.now();
  const token = sign({ uid: user.id, username: user.username, iat: now, exp: now + TOKEN_TTL_MS });
  return { token, user: { id: user.id, username: user.username } };
}

// —— 从请求中解析当前用户（Authorization: Bearer <token>） ——
function userFromRequest(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const payload = verifyToken(m[1]);
  return payload ? { id: payload.uid, username: payload.username } : null;
}

module.exports = { authenticate, userFromRequest, sign, verifyToken, TOKEN_TTL_MS };
