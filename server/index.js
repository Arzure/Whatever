const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadEnv } = require('./config');
const { isConfigured, llmConfig } = require('./llm');
const storage = require('./storage');
const image = require('./image');
const { authenticate, userFromRequest } = require('./auth');
const themes = require('./themes');
const casegen = require('./casegen');
const { getMode, listModes, DEFAULT_MODE } = require('./modes');
const draw = require('./draw');

loadEnv();

const app = express();
const PORT = process.env.PORT || 3001;

// 绘图路由单独放宽请求体上限：图片编辑需上传参考图 Base64（5 张可达数十 MB）
app.use('/api/draw', express.json({ limit: '40mb' }));
app.use(express.json({ limit: '64kb' }));

// CORS：Access-Control-Allow-Origin 取 FRONTEND_ORIGIN（默认 localhost:5173）。
// 注意：开发模式下前端走 Vite 代理（浏览器只与 5173 同源通信，/api 由 Vite 转发到 3001），
// 浏览器层面不跨域、不触发 CORS，此配置并非开发模式必需。
// 它仅在「前端绕过代理、浏览器直连 3001」的场景下生效（如本地调试脚本直连后端）。
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Token, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 访问口令中间件：在 .env 配置 ACCESS_TOKEN 后启用，仅 /api 请求校验 X-Access-Token
// 未配置口令时（本地开发）不拦截，保持原有行为
// 注意：挂载在 /api 路径上，静态页面（frontend/dist）不受口令拦截，页面加载后由前端 AccessGate 组件引导输入口令
// 失败限速（按 IP）：10 分钟窗口内连续失败 5 次锁定 10 分钟，防暴力穷举；成功后清零
// 时间窗口：距上次失败超过 10 分钟则重新计数，避免历史失败累计误伤正常用户
const accessFails = new Map(); // ip -> { fails, lockedUntil, lastFail }
const ACCESS_MAX_FAILS = 5;
const ACCESS_LOCK_MS = 10 * 60 * 1000;
app.use('/api', (req, res, next) => {
  const token = process.env.ACCESS_TOKEN || '';
  if (!token) return next(); // 未启用口令校验
  if (req.path === '/health') return next(); // 健康检查放行（中间件挂载在 /api，此处为相对路径）
  // 绘图历史图片放行：浏览器 img 标签不携带口令头；该路由自带 HMAC 签名鉴权（绑定用户与文件名），安全性足够
  if (req.path.startsWith('/draw/file/')) return next();
  const ip = req.ip || 'unknown';
  const rec = accessFails.get(ip);
  if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
  }
  const provided = req.headers['x-access-token'];
  if (provided !== token) {
    const now = Date.now();
    const r = accessFails.get(ip) || { fails: 0, lockedUntil: 0, lastFail: 0 };
    if (r.lastFail && now - r.lastFail > ACCESS_LOCK_MS) r.fails = 0; // 距上次失败超过窗口期，重新计数
    r.fails += 1;
    r.lastFail = now;
    if (r.fails >= ACCESS_MAX_FAILS) { r.lockedUntil = now + ACCESS_LOCK_MS; r.fails = 0; r.lastFail = 0; }
    accessFails.set(ip, r);
    return res.status(401).json({ error: '访问口令缺失或不正确，请输入正确的访问口令' });
  }
  if (rec) accessFails.delete(ip); // 验证成功，清零失败计数
  next();
});

/** 加载存档并解析其模式；失败时已写出响应，返回 null */
function findGame(req, res) {
  const user = userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: '请先登录' });
    return null;
  }
  const owner = storage.getSaveOwner(req.params.id);
  if (owner && owner !== user.id) {
    // 他人存档统一按不存在处理，不暴露存在性
    res.status(404).json({ error: '存档不存在' });
    return null;
  }
  const game = storage.loadGame(req.params.id);
  if (!game) {
    res.status(404).json({ error: '存档不存在' });
    return null;
  }
  const mode = getMode(game.mode || DEFAULT_MODE);
  if (!mode) {
    res.status(400).json({ error: `存档使用了未知的游戏模式：${game.mode}` });
    return null;
  }
  return { game, mode };
}

/** 统一的存档快照响应（前端据此渲染） */
function snapshot(game) {
  const base = {
    id: game.id,
    mode: game.mode,
    theme: game.theme || null,
    player: game.player,
    history: game.history,
    pendingActions: game.pendingActions || [],
  };
  // 模式可按需附加自己的状态视图（探案模式会剔除真相字段）
  const mode = getMode(game.mode || DEFAULT_MODE);
  if (mode && typeof mode.snapshot === 'function') Object.assign(base, mode.snapshot(game));
  return base;
}

/** 供路由统一判断「游戏是否已结束」（优先使用模式自带判定） */
function overState(mode, game) {
  if (mode && typeof mode.checkOver === 'function') return mode.checkOver(game);
  if (game.player && game.player.hp <= 0) return { over: true, reason: 'lose', message: '角色已经死亡，游戏结束' };
  return { over: false, reason: '', message: '' };
}

function llmMissing(res) {
  return res.status(503).json({
    error: '后端未配置 LLM API。请在项目根目录创建 .env 文件，填写 LLM_API_KEY（与 LLM_BASE_URL、LLM_MODEL）后重启服务。',
  });
}

// —— 账号体系 ——
// 注册（成功即视为登录，返回令牌）
// —— 绘图玩法（生图工作台）：独立于文字冒险，不入存档体系 ——
// 模型与参数清单（UI 配置基础）
app.get('/api/draw/options', (req, res) => {
  res.json({
    enabled: draw.isImageEnabled(),
    models: draw.PRESET_MODELS,
    sizes: draw.PRESET_SIZES,
    outputFormats: draw.OUTPUT_FORMATS,
    defaultModel: process.env.IMAGE_MODEL || 'sensenova-u1.5-fast',
  });
});
// 生图结果落盘入库（历史 24 小时过期）+ 提示词记录（持续保留）；保存失败不影响生图主流程
function saveDrawResult(req, result, modeTag) {
  try {
    const user = userFromRequest(req);
    if (!user || !result || !Array.isArray(result.b64s)) return;
    const p = req.body || {};
    const model = String(p.model || '');
    const size = String(p.size || 'auto');
    const prompt = String(p.prompt || '').trim().slice(0, 2000);
    const ext = ['png', 'jpeg', 'webp'].includes(p.outputFormat) ? p.outputFormat : 'png';
    for (const b64 of result.b64s) {
      const id = `dw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const file = `${id}.${ext}`;
      fs.writeFileSync(path.join(DRAW_DIR, file), Buffer.from(b64, 'base64'));
      // PNG 头解析实际分辨率（宽高在固定偏移 16/20）；其他格式留空由前端图片加载时读取
      let actual = null;
      try {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) actual = `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`;
      } catch { /* 忽略 */ }
      storage.saveDrawHistory(user.id, { id, mode: modeTag, model, size, actual, prompt, file });
    }
    if (prompt) storage.saveDrawPrompt(user.id, prompt);
  } catch (e) {
    console.log('[draw] 历史保存失败（不影响生图）：', e.message);
  }
}
// 文生图代理：透传官方支持的全部参数；成功后保存历史与提示词
app.post('/api/draw/generate', async (req, res) => {
  const result = await draw.generate(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  saveDrawResult(req, result, 'generate');
  res.json(result);
});
// 图片编辑代理（图生图）：参考图 + 编辑提示词；成功后保存历史与提示词
app.post('/api/draw/edit', async (req, res) => {
  const result = await draw.edit(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  saveDrawResult(req, result, 'edit');
  res.json(result);
});

// —— 绘图历史（24 小时过期，图片存文件系统仅元数据入库）与提示词历史（持续保留） ——
const DRAW_DIR = path.join(__dirname, '..', 'data', 'draw');
fs.mkdirSync(DRAW_DIR, { recursive: true });
// 历史列表：登录用户自己的记录；查询时惰性清理过期记录与文件
// 图片 URL 带短期签名（2 小时有效）：浏览器 img 标签请求不携带 JWT 头，
// 签名参数让图片访问既保持按用户隔离又可被 img 直接加载
const crypto = require('crypto');
function signDrawFile(userId, name) {
  const exp = Date.now() + 25 * 60 * 60 * 1000; // 签名有效期略长于图片保留期（24h）：账号登录拉取列表后，图片未过期就能一直显示
  const sig = crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'draw-secret')).update(`${userId}:${name}:${exp}`).digest('hex').slice(0, 32);
  return `/api/draw/file/${name}?uid=${userId}&exp=${exp}&sig=${sig}`;
}
function verifyDrawFileSig(userId, name, exp, sig) {
  if (!userId || !exp || !sig || Number(exp) < Date.now()) return false;
  const expect = crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'draw-secret')).update(`${userId}:${name}:${exp}`).digest('hex').slice(0, 32);
  return expect === sig;
}
app.get('/api/draw/history', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const { rows, expired } = storage.listDrawHistory(user.id);
  for (const e of expired) { try { fs.unlinkSync(path.join(DRAW_DIR, path.basename(e.file))); } catch { /* 文件可能已不存在 */ } }
  res.json({
    rows: rows.map((r) => ({ ...r, url: signDrawFile(user.id, path.basename(r.file)) })),
    ttlHours: 24,
    expiredCount: expired.length, // 本次访问清理的过期图片数量（前端据此提示用户）
  });
});
// 图片文件访问：短期签名校验（img 标签无 JWT 头，靠 URL 签名鉴权；仍按用户隔离）
app.get('/api/draw/file/:name', (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  const { uid, exp, sig } = req.query;
  if (!verifyDrawFileSig(String(uid || ''), name, String(exp || ''), String(sig || ''))) {
    return res.status(401).json({ error: '签名无效或已过期' });
  }
  const row = storage.db.prepare('SELECT 1 FROM draw_history WHERE user_id = ? AND file = ?').get(String(uid), name);
  if (!row) return res.status(404).json({ error: '图片不存在或已过期' });
  res.sendFile(path.join(DRAW_DIR, name));
});
// 删除单条历史（同时删除文件）
app.delete('/api/draw/history/:id', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const file = storage.deleteDrawHistory(user.id, req.params.id);
  if (file) { try { fs.unlinkSync(path.join(DRAW_DIR, path.basename(file))); } catch { /* 忽略 */ } }
  res.json({ ok: true });
});
// 提示词历史：列表与删除（持续保留，UNIQUE 去重）
app.get('/api/draw/prompts', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  res.json({ rows: storage.listDrawPrompts(user.id) });
});
app.delete('/api/draw/prompts/:id', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  storage.deleteDrawPrompt(user.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{2,16}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 2-16 位字母、数字、下划线或中文' });
  }
  if (password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: '密码长度需为 6-64 位' });
  }
  if (storage.findUserByName(username)) {
    return res.status(400).json({ error: '该用户名已被注册' });
  }
  storage.createUser(username, password);
  res.status(201).json(authenticate(username, password));
});

// 登录
app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const result = authenticate(username, password);
  if (result.error) return res.status(401).json({ error: result.error });
  res.json(result);
});

// 当前用户信息（校验令牌有效性）
app.get('/api/auth/me', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
  res.json({ user });
});

// —— 账号管理（均需验证当前密码，防止他人冒用登录态篡改） ——
// 修改用户名
app.post('/api/auth/rename', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
  const password = String(req.body?.password || '');
  const newName = String(req.body?.username || '').trim();
  const record = storage.getUserById(user.id);
  if (!record || !storage.verifyPassword(password, record.password_hash)) {
    return res.status(401).json({ error: '密码错误，无法修改用户名' });
  }
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{2,16}$/.test(newName)) {
    return res.status(400).json({ error: '用户名需为 2-16 位字母、数字、下划线或中文' });
  }
  const existing = storage.findUserByName(newName);
  if (existing && existing.id !== user.id) {
    return res.status(400).json({ error: '该用户名已被注册' });
  }
  storage.renameUser(user.id, newName);
  // 签发含新用户名的令牌，前端替换旧令牌
  const token = require('./auth').sign({ uid: user.id, username: newName, iat: Date.now(), exp: Date.now() + 72 * 60 * 60 * 1000 });
  res.json({ ok: true, token, user: { id: user.id, username: newName } });
});

// 修改密码
app.post('/api/auth/password', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const record = storage.getUserById(user.id);
  if (!record || !storage.verifyPassword(oldPassword, record.password_hash)) {
    return res.status(401).json({ error: '旧密码错误' });
  }
  if (newPassword.length < 6 || newPassword.length > 64) {
    return res.status(400).json({ error: '新密码长度需为 6-64 位' });
  }
  storage.updatePassword(user.id, newPassword);
  res.json({ ok: true });
});

// 删除账号（连同全部存档）
app.post('/api/auth/delete', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
  const password = String(req.body?.password || '');
  const record = storage.getUserById(user.id);
  if (!record || !storage.verifyPassword(password, record.password_hash)) {
    return res.status(401).json({ error: '密码错误，无法删除账号' });
  }
  storage.deleteUserCascade(user.id);
  res.json({ ok: true });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, llm: isConfigured() });
});

// 可用游戏模式
app.get('/api/modes', (req, res) => {
  res.json(listModes());
});

// 内置世界观列表
app.get('/api/themes', (req, res) => {
  res.json(themes.listThemes());
});

// 探案模式可选案件题材
app.get('/api/genres', (req, res) => {
  res.json(casegen.listGenres());
});

// 纯文本世界观 → 结构化为可用的世界观配置（不落盘，由前端带入新建游戏）
app.post('/api/themes/parse', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: '后端未配置 LLM API，无法解析世界观文本。' });
  }
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '世界观文本不能为空' });
  try {
    const theme = await themes.parseThemeFromText(text);
    res.json(theme);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// 存档列表（仅返回当前登录用户自己的存档）
app.get('/api/saves', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  res.json(storage.listSaves(user.id));
});

// 新建游戏
app.post('/api/games', async (req, res) => {
  const modeId = String(req.body?.mode || DEFAULT_MODE).trim();
  const mode = getMode(modeId);
  if (!mode) return res.status(400).json({ error: `未知的游戏模式：${modeId}` });

  const name = String(req.body?.playerName || '').trim().slice(0, 20);

  let theme = null;
  if (mode.needsTheme) {
    theme = resolveTheme(req.body?.theme);
    if (!theme) return res.status(400).json({ error: '无法解析该世界观配置' });
  }

  // 探案模式需要先选案件题材
  let genre = null;
  if (mode.needsGenre) {
    genre = String(req.body?.genre || '').trim();
    if (!genre) return res.status(400).json({ error: '请先选择一个案件题材' });
    if (!casegen.getGenre(genre)) return res.status(400).json({ error: `未知的案件题材：${genre}` });
    if (!isConfigured()) return llmMissing(res);
  }

  // 推理杀板子：standard（七人标准，缺省）| advanced（十人进阶）
  const board = String(req.body?.board || '').trim();
  let game;
  try {
    // newGame 可能是异步的（探案模式需调用 LLM 生成案件）
    game = await mode.newGame(name, { theme, genre, board });
  } catch (err) {
    // 需要调用 LLM 的开局失败属于上游错误，其余归为参数错误
    return mode.needsLLM
      ? res.status(502).json({ error: `开局失败：${err.message}` })
      : res.status(400).json({ error: err.message });
  }
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  if (storage.countSaves(user.id) >= 20) {
    return res.status(400).json({ error: '存档数量已达上限（20 个），请先清理部分存档' });
  }
  storage.saveGame(game.id, game, user.id);
  res.status(201).json(snapshot(game));
});

/**
 * 解析新建游戏时传入的世界观：
 * - 字符串：内置世界观 id（缺省回落到默认世界 azeroth）
 * - 对象：前端导入并已结构化的世界观（经 normalizeTheme 兜底）
 */
function resolveTheme(input) {
  if (input && typeof input === 'object') return themes.normalizeTheme(input);
  const id = String(input || '').trim();
  return themes.getTheme(id || 'azeroth') || themes.getTheme('azeroth');
}

// 读取存档
app.get('/api/games/:id', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  res.json(snapshot(found.game));
});

// 案件说明（含谜底，仅探案模式；前端只在玩家主动展开时请求）
app.get('/api/games/:id/case', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  if (!found.game.case) return res.status(400).json({ error: '该存档没有案件说明' });
  res.json({ case: found.game.case });
});

// 指认凶手（探案模式）
app.post('/api/games/:id/accuse', async (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  if (typeof mode.accuse !== 'function') return res.status(400).json({ error: '当前模式不支持指认凶手' });

  const over = overState(mode, game);
  if (over.over) return res.status(409).json({ error: over.message, gameOver: true });
  if (!isConfigured()) return llmMissing(res);

  const suspectId = String(req.body?.suspectId || '').trim();
  if (!suspectId) return res.status(400).json({ error: '请选择要指认的嫌疑人' });

  try {
    const result = await mode.accuse(game, suspectId);
    if (!result.ok) return res.status(400).json({ error: result.message });
    storage.saveGame(game.id, game);
    res.json(result.payload);
  } catch (err) {
    storage.saveGame(game.id, game);
    res.status(502).json({ error: `指认处理失败：${err.message}` });
  }
});

// 举证令凶手认罪（探案模式）
app.post('/api/games/:id/confront', async (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  if (typeof mode.confront !== 'function') return res.status(400).json({ error: '当前模式不支持举证认罪' });

  const over = overState(mode, game);
  if (over.over) return res.status(409).json({ error: over.message, gameOver: true });
  if (!isConfigured()) return llmMissing(res);

  const clueIds = Array.isArray(req.body?.clues) ? req.body.clues : [];

  try {
    const result = await mode.confront(game, clueIds);
    if (!result.ok) return res.status(400).json({ error: result.message });
    storage.saveGame(game.id, game);
    res.json(result.payload);
  } catch (err) {
    storage.saveGame(game.id, game);
    res.status(502).json({ error: `举证处理失败：${err.message}` });
  }
});

// 投票放逐（狼人杀模式）
app.post('/api/games/:id/vote', async (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  if (typeof mode.vote !== 'function') return res.status(400).json({ error: '当前模式不支持投票' });

  const over = overState(mode, game);
  if (over.over) return res.status(409).json({ error: over.message, gameOver: true });

  const targetId = String(req.body?.targetId || '').trim();
  if (!targetId) return res.status(400).json({ error: '请选择投票目标' });

  try {
    const result = await mode.vote(game, targetId);
    if (!result.ok) return res.status(400).json({ error: result.message });
    storage.saveGame(game.id, game);
    res.json(result.payload);
  } catch (err) {
    storage.saveGame(game.id, game);
    res.status(502).json({ error: `投票处理失败：${err.message}` });
  }
});

// 法官裁决（推理杀模式：处刑某人或放弃处刑）
app.post('/api/games/:id/adjudicate', async (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  if (typeof mode.adjudicate !== 'function') return res.status(400).json({ error: '当前模式不支持裁决' });

  const over = overState(mode, game);
  if (over.over) return res.status(409).json({ error: over.message, gameOver: true });

  // targetId 为空表示放弃处刑；targetIds 数组支持多目标处决（十人进阶局最多两人）
  const targetId = String(req.body?.targetId || '').trim();
  let targetIds = Array.isArray(req.body?.targetIds) ? req.body.targetIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!targetIds.length && targetId) targetIds = [targetId];

  try {
    const result = await mode.adjudicate(game, targetIds.length > 1 ? targetIds : (targetIds[0] || ''));
    if (!result.ok) return res.status(400).json({ error: result.message });
    storage.saveGame(game.id, game);
    res.json(result.payload);
  } catch (err) {
    storage.saveGame(game.id, game);
    res.status(502).json({ error: `裁决处理失败：${err.message}` });
  }
});

// —— 推理杀推测身份标记（云端同步，随存档保存） ——
// 读取标记
app.get('/api/games/:id/marks', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  res.json({ marks: found.game.marks || {} });
});

// 保存标记（整体覆盖）
app.post('/api/games/:id/marks', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const marks = req.body?.marks;
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) {
    return res.status(400).json({ error: '标记数据格式不正确' });
  }
  // 只保留字符串值，防止任意结构注入存档
  const clean = {};
  for (const [k, v] of Object.entries(marks)) {
    if (typeof v === 'string' && v.length <= 20) clean[k] = v;
  }
  found.game.marks = clean;
  found.game.updatedAt = Date.now();
  storage.saveGame(found.game.id, found.game);
  res.json({ ok: true });
});

// 存档（手动保存，返回当前快照）
app.post('/api/games/:id/save', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  found.game.updatedAt = Date.now();
  storage.saveGame(found.game.id, found.game);
  res.json({ ok: true });
});

// 删除存档（仅限本人）
app.delete('/api/games/:id', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const owner = storage.getSaveOwner(req.params.id);
  if (owner && owner !== user.id) return res.status(404).json({ error: '存档不存在' });
  storage.deleteGame(req.params.id);
  res.json({ ok: true });
});

// 终局插画（推理杀）：为存档生成主题插画；未配置 IMAGE_MODEL 时返回 disabled
// 终局插画（推理杀）：资产合成——按胜负抽取背景（win/lose 各 5 张），按存活角色身份与性别选取人物剪影叠放其上；
// 背景与剪影均为预生成资产（server/assets/endings/），合成由 Python Pillow 完成，秒出、零生图费用
app.post('/api/games/:id/ending-art', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game } = found;
  if (game.mode !== 'deduction') return res.status(400).json({ error: '该模式不支持终局插画' });
  const w = game.deduction;
  if (!(w.phase === 'win' || w.phase === 'lose')) return res.status(400).json({ error: '游戏尚未结束' });
  const dir = path.join(__dirname, 'assets', 'endings');
  if (!fs.existsSync(dir)) return res.json({ disabled: true });
  // 背景池：按胜负过滤
  const prefix = w.winner === 'good' ? 'win-' : 'lose-';
  const bgs = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.png')).sort();
  if (!bgs.length) return res.json({ disabled: true });
  // 确定性抽取背景（同一存档固定同一张，不同局随机换新）
  let h = 0;
  const key = req.params.id + ':ending';
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const bg = bgs[h % bgs.length];
  // 存活角色：身份（英文 key 转中文）+ 性别 → 剪影文件
  const ROLE_CN_END = {
    clerk: '文员', detective: '侦探', villager: '村民', forensics: '法医', guard: '守卫',
    gambler: '赌徒', thief: '小偷', wolf: '狼人', accomplice: '帮凶', drunkard: '酒鬼',
    watcher: '观者', postman: '邮差', walker: '行者', quack: '庸医', spy: '间谍', clown: '小丑', warlock: '术士',
  };
  const FEMALE_NAMES_END = ['婉清', '苏晴', '孟瑶', '语嫣', '许诺'];
  const survivors = (w.players || []).filter((x) => x.alive).map((x) => ({
    role: ROLE_CN_END[x.roleBackup || x.role] || x.role,
    gender: FEMALE_NAMES_END.includes(x.name) ? '女' : '男',
  }));
  const silhouettes = survivors
    .map((s) => path.join(dir, `${s.role}-剪-${s.gender}.png`))
    .filter((p) => fs.existsSync(p));
  // 合成：调用 Python 脚本（Pillow）把剪影叠放在背景上（按胜负着色：胜利暖金/失败冷银蓝，与暗背景强对比）
  const { execFile } = require('child_process');
  const flag = w.winner === 'good' ? '--win' : '--lose';
  const args = [path.join(__dirname, 'scripts', 'compose_ending.py'), path.join(dir, bg), flag, ...silhouettes];
  execFile('python3', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
    if (err) {
      console.log('[ending] 合成失败：', err.message);
      return res.json({ disabled: true });
    }
    const b64 = stdout.trim();
    if (!b64) return res.json({ disabled: true });
    res.json({ b64 });
  });
});

// 角色立绘（推理杀终局）：从预生成资产库随机抽取（点击秒出、零生图费用）
// 资产由 server/scripts/gen-portraits.js 一次性生成：每角色多张带阵营气质的 512x512 半身头像；
// 选择方式：按『存档id+角色名』哈希确定 variant——同一局同一角色固定同一张，不同局随机换新保持新鲜感
// 性能：文件内容内存缓存（避免每次请求重复读盘）
const portraitFileCache = new Map(); // 文件名 -> base64
function readPortraitCached(file) {
  if (portraitFileCache.has(file)) return portraitFileCache.get(file);
  const b64 = fs.readFileSync(file).toString('base64');
  if (portraitFileCache.size > 200) portraitFileCache.clear(); // 简单上限保护
  portraitFileCache.set(file, b64);
  return b64;
}
app.post('/api/games/:id/portrait', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game } = found;
  if (game.mode !== 'deduction') return res.status(400).json({ error: '该模式不支持角色立绘' });
  const w = game.deduction;
  if (!(w.phase === 'win' || w.phase === 'lose')) return res.status(400).json({ error: '游戏尚未结束' });
  const name = String(req.body?.name || '').trim();
  const p = w.players.find((x) => x.name === name);
  if (!p) return res.status(404).json({ error: '角色不存在' });
  // 变身者用变身后的角色立绘（狼人气质）；存档中 role 为英文 key，需转中文职业名匹配资产文件
  const ROLE_CN = {
    clerk: '文员', detective: '侦探', villager: '村民', forensics: '法医', guard: '守卫',
    gambler: '赌徒', thief: '小偷', wolf: '狼人', accomplice: '帮凶', drunkard: '酒鬼',
    watcher: '观者', postman: '邮差', walker: '行者', quack: '庸医', spy: '间谍', clown: '小丑', warlock: '术士',
  };
  const roleKey = p.roleBackup || p.role;
  const role = ROLE_CN[roleKey] || roleKey;
  // 女性名字的角色优先用女性版立绘（文件名带『女』标记）；无女性版资产时回退普通版
  const FEMALE_NAMES = ['婉清', '苏晴', '孟瑶', '语嫣', '许诺'];
  const isFemale = FEMALE_NAMES.includes(name);
  // 优先读 96x96 小图（显示仅 44px 圆形头像，小图体积约 5%，省流量加速显示）；无小图回退 512 原图
  const dirSmall = path.join(__dirname, 'assets', 'portraits-small');
  const dir = fs.existsSync(dirSmall) ? dirSmall : path.join(__dirname, 'assets', 'portraits');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith(role + '-') && f.endsWith('.png')).sort();
  } catch { /* 资产目录不存在 */ }
  if (isFemale) {
    const femaleFiles = files.filter((f) => /-女\d\.png$/.test(f));
    if (femaleFiles.length) files = femaleFiles;
  } else {
    files = files.filter((f) => !/-女\d\.png$/.test(f));
  }
  if (!files.length) return res.json({ disabled: true });
  // 确定性随机：同一存档同一角色固定选同一张
  let h = 0;
  const key = req.params.id + ':' + name;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const file = files[h % files.length];
  try {
    const b64 = readPortraitCached(path.join(dir, file));
    res.json({ b64 });
  } catch {
    res.json({ disabled: true });
  }
});

// 一键清空存档（仅删除当前登录用户名下的全部存档，不影响他人数据）
app.delete('/api/games', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const deleted = storage.deleteAllSaves(user.id);
  res.json({ ok: true, deleted });
});

// 使用道具（从背包移除，记为待结算动作，效果延迟到下次 AI 回合）
app.post('/api/games/:id/use-item', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  const item = String(req.body?.item || '').trim();
  if (!item) return res.status(400).json({ error: '物品名不能为空' });
  const result = mode.useItem(game, item);
  if (!result.ok) return res.status(400).json({ error: result.message });
  storage.saveGame(game.id, game);
  res.json({ ok: true, player: game.player, pendingActions: game.pendingActions, message: result.message });
});

// 装备背包中的武器/防具
app.post('/api/games/:id/equip', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  const item = String(req.body?.item || '').trim();
  if (!item) return res.status(400).json({ error: '物品名不能为空' });
  const result = mode.equipItem(game, item);
  if (!result.ok) return res.status(400).json({ error: result.message });
  storage.saveGame(game.id, game);
  res.json({ ok: true, player: game.player, pendingActions: game.pendingActions, message: result.message });
});

// 卸下当前武器/防具
app.post('/api/games/:id/unequip', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  const slot = String(req.body?.slot || '').trim();
  const result = mode.unequipItem(game, slot);
  if (!result.ok) return res.status(400).json({ error: result.message });
  storage.saveGame(game.id, game);
  res.json({ ok: true, player: game.player, pendingActions: game.pendingActions, message: result.message });
});

// 丢弃背包中的物品（默认丢弃 1 个，记为待结算动作）
app.post('/api/games/:id/discard', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  const item = String(req.body?.item || '').trim();
  if (!item) return res.status(400).json({ error: '物品名不能为空' });
  const result = mode.discardItem(game, item);
  if (!result.ok) return res.status(400).json({ error: result.message });
  storage.saveGame(game.id, game);
  res.json({ ok: true, player: game.player, pendingActions: game.pendingActions, message: result.message });
});

// 撤销待结算动作（恢复道具/状态）
app.post('/api/games/:id/cancel-pending', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;
  const index = Number(req.body?.index);
  if (!Number.isInteger(index)) return res.status(400).json({ error: '缺少有效的动作索引' });
  const result = mode.cancelPendingAction(game, index);
  if (!result.ok) return res.status(400).json({ error: result.message });
  storage.saveGame(game.id, game);
  res.json({ ok: true, player: game.player, pendingActions: game.pendingActions, message: result.message });
});

// 执行动作（核心游戏循环）
app.post('/api/games/:id/action', async (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game, mode } = found;

  const over = overState(mode, game);
  if (over.over) {
    return res.status(409).json({ error: over.message, gameOver: true });
  }

  const input = String(req.body?.action || '').trim().slice(0, 200);
  if (!input) return res.status(400).json({ error: '动作不能为空' });

  if (!isConfigured()) return llmMissing(res);

  // 场景切换按钮通道：显式指定目标场景（探案模式使用）
  const sceneId = String(req.body?.scene || '').trim();

  try {
    const result = await mode.processAction(game, input, { sceneId });
    storage.saveGame(game.id, game);
    res.json(result);
  } catch (err) {
    // 出错时把玩家输入从历史中回滚，避免污染后续上下文
    if (game.history.length && game.history[game.history.length - 1].role === 'user') {
      game.history.pop();
    }
    storage.saveGame(game.id, game);
    res.status(502).json({ error: `AI 处理失败：${err.message}` });
  }
});

// 生产模式：托管前端构建产物
const dist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(dist));

app.listen(PORT, () => {
  console.log(`[文字冒险] 服务已启动: http://localhost:${PORT}`);
  console.log(`[文字冒险] LLM 配置状态: ${isConfigured() ? '已配置' : '未配置（请填写 .env）'}`);
  if (isConfigured()) {
    const cfg = llmConfig();
    console.log(`[文字冒险] 模型: ${cfg.model} | 服务: ${cfg.baseUrl}`);
  }
});
