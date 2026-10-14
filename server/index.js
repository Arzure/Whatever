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

loadEnv();

const app = express();
const PORT = process.env.PORT || 3001;

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
// 失败限速（按 IP）：连续失败 5 次锁定 10 分钟，防暴力穷举；成功后清零
const accessFails = new Map(); // ip -> { fails, lockedUntil }
const ACCESS_MAX_FAILS = 5;
const ACCESS_LOCK_MS = 10 * 60 * 1000;
app.use('/api', (req, res, next) => {
  const token = process.env.ACCESS_TOKEN || '';
  if (!token) return next(); // 未启用口令校验
  if (req.path === '/health') return next(); // 健康检查放行（中间件挂载在 /api，此处为相对路径）
  const ip = req.ip || 'unknown';
  const rec = accessFails.get(ip);
  if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
  }
  const provided = req.headers['x-access-token'];
  if (provided !== token) {
    const r = accessFails.get(ip) || { fails: 0, lockedUntil: 0 };
    r.fails += 1;
    if (r.fails >= ACCESS_MAX_FAILS) { r.lockedUntil = Date.now() + ACCESS_LOCK_MS; r.fails = 0; }
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
app.post('/api/games/:id/ending-art', async (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  const { game } = found;
  if (game.mode !== 'deduction') return res.status(400).json({ error: '该模式不支持终局插画' });
  const w = game.deduction;
  if (!(w.phase === 'win' || w.phase === 'lose')) return res.status(400).json({ error: '游戏尚未结束' });
  if (!image.isImageEnabled()) return res.json({ disabled: true });
  const winner = w.winner === 'good' ? '好人胜利' : '狼人胜利';
  // 依据终局场上剩余角色及身份描绘一个事件场景（比固定剪影更有叙事感）
  // 存档中 role 为英文 key，转中文职业名进入提示词
  const ROLE_CN_END = {
    clerk: '文员', detective: '侦探', villager: '村民', forensics: '法医', guard: '守卫',
    gambler: '赌徒', thief: '小偷', wolf: '狼人', accomplice: '帮凶', drunkard: '酒鬼',
    watcher: '观者', postman: '邮差', walker: '行者', quack: '庸医', spy: '间谍', clown: '小丑', warlock: '术士',
  };
  const survivors = (w.players || []).filter((x) => x.alive);
  const survivorDesc = survivors
    .map((x) => `${x.name}（${x.roleBackup ? (ROLE_CN_END[x.roleBackup] || x.roleBackup) + '变身狼人' : (ROLE_CN_END[x.role] || x.role)}）`)
    .join('、');
  const prompt = `暗色调中世纪村庄剪影插画，${winner}结局：天亮后的村庄广场上，幸存者${survivorDesc}聚集在一起的场景，月光与晨光交界，人物为剪影轮廓但姿态各异反映其身份，神秘悬疑氛围，扁平插画风格，深蓝与金色配色，无文字`;
  const result = await image.generateImage(`${req.params.id}:ending`, prompt, { size: '768x768' });
  if (!result) return res.json({ disabled: true });
  res.json({ b64: result.b64 });
});

// 角色立绘（推理杀终局）：从预生成资产库随机抽取（点击秒出、零生图费用）
// 资产由 server/scripts/gen-portraits.js 一次性生成：每角色多张带阵营气质的 512x512 半身头像；
// 选择方式：按『存档id+角色名』哈希确定 variant——同一局同一角色固定同一张，不同局随机换新保持新鲜感
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
  const dir = path.join(__dirname, 'assets', 'portraits');
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
    const b64 = fs.readFileSync(path.join(dir, file)).toString('base64');
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
