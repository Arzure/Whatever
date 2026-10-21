const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadEnv } = require('./config');
const { isConfigured, llmConfig, chat: llmChat } = require('./llm');
const storage = require('./storage');
const image = require('./image');
const { authenticate, userFromRequest, hashPassword } = require('./auth');
const themes = require('./themes');
const casegen = require('./casegen');
const { getMode, listModes, DEFAULT_MODE } = require('./modes');
const draw = require('./draw');
const office = require('./office');
const resume = require('./resume'); // 简历图合成（方案 A：背景生成 + 文字程序化绘制）
const docparse = require('./docparse'); // 文档解析：Word/PDF 文本提取（办公助手文档素材）
const multer = require('multer'); // 文件上传中间件（文档解析接口）
const uploadDoc = multer({
  storage: multer.memoryStorage(), // 内存暂存，解析后即弃，不落盘
  limits: { fileSize: docparse.MAX_BYTES, files: 1 },
});
const excel = require('./excel');

loadEnv();

// —— 管理员功能（第一期：用户管理）——
// 管理员由 .env 的 ADMIN_USERNAMES 指定（逗号分隔用户名），服务启动时同步标记到数据库
// 同步策略：名单内的标记为管理员；名单外的清掉标记（改配置重启即生效，撤销即时）
function syncAdminFlags() {
  const names = String(process.env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const all = storage.listUsersForAdmin();
  for (const u of all) {
    const should = names.includes(u.username) ? 1 : 0;
    if (u.is_admin !== should) storage.setAdminByUsername(u.username, should);
  }
  if (names.length) console.log(`[管理] 管理员已同步: ${names.join(', ')}`);
}
syncAdminFlags();
// 管理员鉴权：JWT 解出用户 → 每次查库确认 is_admin（不进 JWT，撤销即时生效）
function requireAdmin(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const row = storage.findUserById(user.id);
  if (!row || !row.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// —— 用户活跃追踪（管理员界面用）——
// 在线判定：最近 5 分钟内有请求视为在线（心跳由各请求顺带记录，无需前端专门上报）
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const lastSeen = new Map(); // userId -> 最近请求时间戳
// 在线历史：每次会话（从离线到在线的转变）入库一行，供管理员回看
function trackActivity(req, res, next) {
  const user = userFromRequest(req);
  if (user) {
    const prev = lastSeen.get(user.id) || 0;
    const now = Date.now();
    // 从离线（或首次）转为在线：记录一次上线
    if (now - prev > ONLINE_WINDOW_MS) {
      storage.recordOnlineSession(user.id);
    }
    lastSeen.set(user.id, now);
  }
  next();
}

const app = express();
// 信任反向代理（Caddy）：从 X-Forwarded-For 头读取真实客户端 IP——
// 不配置时所有经代理的请求在服务端眼里都是回环 IP（127.0.0.1），
// 一个用户触发限速会连累全部用户被锁（实际发生过：本机测试错误口令锁定了回环 IP，所有线上用户被拒）
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;
// 用户活跃追踪：挂在所有 /api 请求上（心跳顺带记录，无需前端专门上报）
app.use('/api', trackActivity);
// 监听地址：生产默认仅本机回环（127.0.0.1）——外部流量一律走 Caddy 反代，公网无法直连后端（纵深防御）
// 开发模式（NODE_ENV != production）监听所有网卡，便于本机浏览器直接访问调试
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

// 绘图路由单独放宽请求体上限：图片编辑需上传参考图 Base64（5 张可达数十 MB）
app.use('/api/draw', express.json({ limit: '40mb' }));
// 办公助手单独放宽：图表解读需上传图片 Base64（单张限制 12MB，与绘图参考图一致）
app.use('/api/office', express.json({ limit: '20mb' }));
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
  // 办公历史文件放行：同绘图文件机制，HMAC 签名鉴权（绑定用户与文件名）
  if (req.path.startsWith('/office/file/')) return next();
  const ip = req.ip || 'unknown';
  const rec = accessFails.get(ip);
  if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
  }
  const provided = req.headers['x-access-token'];
  if (provided !== token) {
    // 限速计数只针对『带错误口令』的请求（暴力穷举特征）；
    // 无口令头的请求（浏览器首次访问/前端探测）是正常流程，不计失败——
    // 否则快速刷新页面的探测请求会累积失败锁定 IP，导致正确口令也被拒（实际发生过）
    if (provided !== undefined) {
      const now = Date.now();
      const r = accessFails.get(ip) || { fails: 0, lockedUntil: 0, lastFail: 0 };
      if (r.lastFail && now - r.lastFail > ACCESS_LOCK_MS) r.fails = 0; // 距上次失败超过窗口期，重新计数
      r.fails += 1;
      r.lastFail = now;
      if (r.fails >= ACCESS_MAX_FAILS) { r.lockedUntil = now + ACCESS_LOCK_MS; r.fails = 0; r.lastFail = 0; }
      accessFails.set(ip, r);
    }
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
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(DRAW_DIR, file), buf);
      // PNG 头解析实际分辨率（宽高在固定偏移 16/20）；WebP 解析 RIFF 头（VP8/VP8L/VP8X 三种编码）；其他格式留空由前端图片加载时读取
      let actual = null;
      try {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
          actual = `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`;
        } else if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
          const chunk = buf.toString('ascii', 12, 16);
          if (chunk === 'VP8X') {
            // 扩展格式：画布宽高各 24 位（实际值-1），位于偏移 24/27
            const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
            const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
            actual = `${w}×${h}`;
          } else if (chunk === 'VP8 ') {
            // 有损编码：同步码后宽高各 14 位，位于偏移 26/28
            const w = buf.readUInt16LE(26) & 0x3fff;
            const h = buf.readUInt16LE(28) & 0x3fff;
            actual = `${w}×${h}`;
          } else if (chunk === 'VP8L') {
            // 无损编码：签名 0x2f 后打包 32 位（宽-1 / 高-1 各 14 位），位于偏移 21
            const b = buf.readUInt32LE(21);
            const w = (b & 0x3fff) + 1;
            const h = ((b >> 14) & 0x3fff) + 1;
            actual = `${w}×${h}`;
          }
        }
      } catch { /* 忽略 */ }
      storage.saveDrawHistory(user.id, { id, mode: modeTag, model, size, actual, prompt, file, bytes: buf.length });
    }
    if (prompt) storage.saveDrawPrompt(user.id, prompt, p.promptSource); // 来源标记：办公内容不进绘图工作台的提示词历史
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

// —— 办公助手（阶段 1）：信息图 + 简历图；提示词体系移植自商汤开源技能，复用绘图管线，结果进绘图历史 ——
// 配置：布局/风格清单与可用尺寸（前端选项渲染依据）
app.get('/api/office/config', (req, res) => {
  res.json({
    enabled: draw.isImageEnabled(),
    models: draw.PRESET_MODELS,
    layouts: office.INFOGRAPHIC_LAYOUTS,
    styles: office.INFOGRAPHIC_STYLES,
    infographicSizes: office.INFOGRAPHIC_SIZES,
    resumeSizes: office.RESUME_SIZES,
    reportStructures: office.REPORT_STRUCTURES,
    defaultModel: process.env.IMAGE_MODEL || 'sensenova-u1.5-fast',
  });
});
// 文档解析：上传 Word/PDF → 提取纯文本返回（前端预览确认后作为 PPT/写作的文档素材）
app.post('/api/office/doc-parse', uploadDoc.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: '请选择要上传的文档' });
    const text = await docparse.parseDocument(req.file.buffer, req.file.originalname);
    res.json({ text, chars: text.length, filename: req.file.originalname });
  } catch (e) {
    res.status(400).json({ error: e.message || '文档解析失败' });
  }
});
// 信息图生成：内容 + 布局 + 风格 → 组装提示词 → 复用绘图管线 → 自动检测修正乱码（实测验证方案）
app.post('/api/office/infographic', async (req, res) => {
  const p = req.body || {};
  const content = String(p.content || '').trim();
  if (!content) return res.status(400).json({ error: '请填写信息图内容' });
  if (content.length > 4000) return res.status(400).json({ error: '内容过长（限 4000 字）' });
  const prompt = office.buildInfographicPrompt(content, p.layout, p.style);
  const result = await draw.generate({ ...p, prompt, watermark: false, outputFormat: 'webp', promptExtend: false }); // 不带水印；WebP 输出；关闭提示词扩展（实测：扩展改写会丢失简历具体内容）
  if (result.error) return res.status(400).json({ error: result.error });

  // —— 乱码自动检测修正（最多两轮；检测用对话模型多模态，修正用图片编辑按精确清单替换）——
  let garbleFixed = 0; // 实际修正的乱码处数（响应给前端展示）
  if (isConfigured() && Array.isArray(result.b64s) && result.b64s[0]) {
    let currentB64 = result.b64s[0];
    for (let round = 0; round < 2; round++) {
      let garbles = [];
      // 检测：视觉模型找出乱码并推断正确文字（空内容失败率约一半，失败自动重试两次）
      for (let attempt = 0; attempt < 3 && !garbles.length; attempt++) {
        try {
          const detectContent = [
            { type: 'text', text: office.buildGarbleDetectPrompt() },
            { type: 'image_url', image_url: { url: `data:image/webp;base64,${currentB64}` } },
          ];
          const detectText = await llmChat([{ role: 'user', content: detectContent }], {
            responseFormat: null,
            reasoningEffort: 'none',
            reasoningFallback: true, // 空内容时用思考字段兜底（思考中常已含乱码分析结论，宽松解析可提取）
            temperature: 0.1,
            // 实测：模型偶发忽略 reasoning_effort:none 进入思考模式，思考与正文共享 max_tokens 配额，
            // 配额 2000 时思考可耗尽全部配额导致正文为空（finish_reason=length, reasoning_tokens=2000）
            maxTokens: 8000,
            timeoutMs: 120000,
          });
          garbles = office.parseGarbleList(detectText);
          console.log(`[信息图] 乱码检测 第${round + 1}轮第${attempt + 1}次: 返回${(detectText || '').length}字, 解析${garbles.length}处`);
          // 明确无乱码则不重试——但仅限正常正文（短文本）；思考兜底内容（长文本）中『文字清晰』等字样
          // 是逐块扫描的中间描述而非最终结论，不能据此短路（实测 1.3 万字思考内容含『清晰』误触发放行）
          if (!garbles.length && detectText && detectText.length < 500 && /没有乱码|无乱码|清晰/.test(String(detectText))) break;
        } catch (e) { console.log(`[信息图] 乱码检测 第${round + 1}轮第${attempt + 1}次失败: ${e.message}`); /* 空内容等失败：重试 */ }
      }
      if (!garbles.length) break; // 无乱码（或检测三次均失败）——放行当前结果
      try {
        // 修正：图片编辑按精确清单替换（任务从『创作』变『抄写』，实测一次成功）
        const fixed = await draw.edit({
          images: [`data:image/webp;base64,${currentB64}`],
          prompt: office.buildGarbleFixPrompt(garbles),
          model: 'sensenova-u1.5-lite', // 修正用质量版，文字渲染更稳
          size: 'auto',
          outputFormat: 'webp',
          promptExtend: false,
          watermark: false, // 与生成环节一致不带水印（漏传时默认 true，修正图会带水印）
        });
        if (fixed.error || !Array.isArray(fixed.b64s) || !fixed.b64s[0]) break; // 修正失败返回当前结果
        currentB64 = fixed.b64s[0];
        garbleFixed += garbles.length;
        console.log(`[信息图] 乱码修正 第${round + 1}轮: 已修正${garbles.length}处`);
      } catch { break; }
    }
    if (garbleFixed > 0) result.b64s = [currentB64]; // 有修正才替换结果
  }

  req.body.outputFormat = 'webp'; // 历史保存按实际输出格式命名扩展名
  req.body.prompt = content.slice(0, 2000); // 历史记录保存用户原始内容而非组装后的长提示词
  req.body.promptSource = 'office:infographic'; // 提示词记录标记办公·信息图标签（各标签历史互不混杂）
  saveDrawResult(req, result, 'infographic');
  res.json({ ...result, garbleFixed }); // garbleFixed：本次自动修正的乱码处数（前端展示用）
});
// 简历图生成（方案 A：文字 100% 准确）——图像模型只画无文字背景，文字由 sharp 程序化绘制
app.post('/api/office/resume', async (req, res) => {
  const p = req.body || {};
  const content = String(p.content || '').trim();
  if (!content) return res.status(400).json({ error: '请填写简历内容' });
  if (content.length > 4000) return res.status(400).json({ error: '简历内容过长（限 4000 字）' });
  try {
    // 第一步：生成无文字背景模板（模型只管配色构图，严禁画文字）
    const bgPrompt = resume.buildBackgroundPrompt(p.style);
    const bg = await draw.generate({ ...p, prompt: bgPrompt, size: '1536x2720', watermark: false, outputFormat: 'webp', promptExtend: false });
    if (bg.error) return res.status(400).json({ error: bg.error });
    // 第二步：解析简历文本 + 程序化合成文字层（确定性渲染，零乱码）
    const data = resume.structureResume(resume.parseResume(content));
    const palette = { text: '#1a1a2e', textDim: '#3d4454', accent: '#b8860b', onAccent: '#ffffff' }; // 深色文字：背景提示词已约束下方为浅色区域
    const bgBuf = Buffer.from(bg.b64s[0], 'base64');
    const composed = await resume.composeResume(bgBuf, data, palette);
    const result = { b64s: [composed.toString('base64')] };
    req.body.outputFormat = 'webp';
    req.body.prompt = content.slice(0, 2000);
    req.body.promptSource = 'office:resume'; // 提示词记录标记办公·简历图标签
    saveDrawResult(req, result, 'resume');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `简历图生成失败：${e.message}` });
  }
});
// Excel 数据分析：上传文件 Base64 → 解析（限 5000 行）→ 对话模型分析 → 返回解读文本
app.post('/api/office/excel', async (req, res) => {
  const p = req.body || {};
  const fileB64 = String(p.file || '');
  if (!fileB64) return res.status(400).json({ error: '请上传 Excel/CSV 文件' });
  const buf = Buffer.from(fileB64, 'base64');
  if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ error: '文件过大（超过 10MB）' });
  const parsed = excel.parseExcel(buf);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const question = String(p.question || '').trim().slice(0, 500);
  if (!isConfigured()) return res.status(503).json({ error: '未配置对话模型 API Key' });
  try {
    const prompt = excel.buildAnalysisPrompt(parsed, question);
    const text = await llmChat([{ role: 'user', content: prompt }], {
      responseFormat: null, // 自由文本输出
      reasoningEffort: 'none',
      temperature: 0.4,
      maxTokens: 3000,
      timeoutMs: 180000, // 数据分析较慢，放宽超时
    });
    saveOfficeResult(req, 'excel', question ? `Excel分析：${question.slice(0, 50)}` : 'Excel 数据分析', text, 'md'); // 24 小时暂存
    res.json({
      text,
      meta: {
        totalRows: parsed.totalRows,
        sheets: parsed.sheets.map((s) => ({ name: s.name, rowCount: s.rowCount, headers: s.headers })),
      },
    });
  } catch (e) {
    res.status(500).json({ error: `分析失败：${e.message}` });
  }
});
// 图表解读：上传图表截图 → 多模态模型解读数据趋势/异常点/结论建议（自由文本输出，不入绘图历史）
app.post('/api/office/chart', async (req, res) => {
  const p = req.body || {};
  const image = String(p.image || '');
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
    return res.status(400).json({ error: '请上传有效的图表图片（png/jpeg/webp）' });
  }
  if (image.length > 12 * 1024 * 1024) return res.status(400).json({ error: '图片过大（Base64 超过 12MB）' });
  const question = String(p.question || '').trim().slice(0, 500);
  if (!isConfigured()) return res.status(503).json({ error: '未配置对话模型 API Key' });
  try {
    const content = [
      { type: 'text', text: '你是数据分析专家。请解读这张图表：1) 说明图表类型与展示的内容；2) 概述主要数据与趋势；3) 指出值得注意的异常点或拐点；4) 给出简明的结论与建议。使用中文，条理清晰，总长不超过 500 字。' + (question ? `\n\n用户特别关注的问题：${question}` : '') },
      { type: 'image_url', image_url: { url: image } },
    ];
    const text = await llmChat([{ role: 'user', content }], {
      responseFormat: null, // 自由文本输出（参数化后支持）
      reasoningEffort: 'none',
      temperature: 0.4,
      maxTokens: 2000,
      timeoutMs: 120000, // 多模态解读较慢，放宽超时
    });
    saveOfficeResult(req, 'chart', question ? `图表解读：${question.slice(0, 50)}` : '图表解读', text, 'md'); // 24 小时暂存
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: `解读失败：${e.message}` });
  }
});

// 风格模仿：参考图 + 新内容 → VLM 提取风格 → 组装提示词 → 复用绘图管线（入绘图历史）
// 图转提示词：上传图片 → VLM 反向解析四段结构化提示词 → 返回给前端编辑后走生成管线
app.post('/api/draw/extract-prompt', async (req, res) => {
  const p = req.body || {};
  const image = String(p.image || '');
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
    return res.status(400).json({ error: '请上传有效的参考图（png/jpeg/webp）' });
  }
  if (image.length > 12 * 1024 * 1024) return res.status(400).json({ error: '参考图过大（Base64 超过 12MB）' });
  if (!isConfigured()) return res.status(503).json({ error: '未配置对话模型 API Key' });
  try {
    // VLM 解析提示词：带思考兜底与重试（复用乱码检测的稳定性防护经验）
    let raw = '';
    for (let attempt = 0; attempt < 3 && !raw; attempt++) {
      try {
        raw = await llmChat([{ role: 'user', content: [
          { type: 'text', text: office.buildExtractPromptPrompt() },
          { type: 'image_url', image_url: { url: image } },
        ] }], { responseFormat: null, reasoningEffort: 'none', reasoningFallback: true, temperature: 0.2, maxTokens: 2000, timeoutMs: 120000 });
        console.log(`[图转提示词] 第${attempt + 1}次: 返回${(raw || '').length}字`);
      } catch (e) {
        console.log(`[图转提示词] 第${attempt + 1}次失败: ${e.message}`);
      }
    }
    if (!raw) return res.status(502).json({ error: '解析提示词失败，请重试' });
    // 四段解析：『段名：内容』逐行提取（宽松匹配，缺段不报错）
    const seg = { subject: '', style: '', composition: '', mood: '' };
    const map = [['主体内容', 'subject'], ['艺术风格', 'style'], ['构图视角', 'composition'], ['色调氛围', 'mood']];
    for (const line of String(raw).split('\n')) {
      for (const [label, key] of map) {
        const m = line.match(new RegExp(label + '[：:]\\s*(.+)'));
        if (m && !seg[key]) seg[key] = m[1].trim().slice(0, 200);
      }
    }
    const prompt = [seg.subject, seg.style, seg.composition, seg.mood].filter(Boolean).join('，');
    if (!prompt) return res.status(502).json({ error: '解析结果为空，请重试' });
    res.json({ prompt, segments: seg });
  } catch (e) {
    console.log('[图转提示词] 异常:', e.message);
    res.status(500).json({ error: '解析提示词失败：' + e.message });
  }
});

app.post('/api/office/imitate', async (req, res) => {
  const p = req.body || {};
  const image = String(p.image || '');
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
    return res.status(400).json({ error: '请上传有效的参考图（png/jpeg/webp）' });
  }
  if (image.length > 12 * 1024 * 1024) return res.status(400).json({ error: '参考图过大（Base64 超过 12MB）' });
  const targetContent = String(p.content || '').trim();
  if (!targetContent) return res.status(400).json({ error: '请填写新图内容' });
  if (targetContent.length > 2000) return res.status(400).json({ error: '新图内容过长（限 2000 字）' });
  if (!isConfigured()) return res.status(503).json({ error: '未配置对话模型 API Key' });
  try {
    // 第一步：VLM 提取参考图风格描述（视觉多模态调用，与图表解读同管线）
    const annotateContent = [
      { type: 'text', text: office.buildImitateAnnotatePrompt() },
      { type: 'image_url', image_url: { url: image } },
    ];
    const styleDesc = await llmChat([{ role: 'user', content: annotateContent }], {
      responseFormat: null,
      reasoningEffort: 'none',
      temperature: 0.3,
      maxTokens: 1000,
      timeoutMs: 120000,
    });
    // 第二步：组装生成提示词 → 复用绘图管线
    const prompt = office.buildImitatePrompt(String(styleDesc || '').trim(), targetContent);
    const result = await draw.generate({ ...p, prompt, watermark: false, outputFormat: 'webp', promptExtend: false });
    if (result.error) return res.status(400).json({ error: result.error });
    req.body.outputFormat = 'webp';
    req.body.prompt = targetContent.slice(0, 2000); // 历史记录保存用户原始内容
    req.body.promptSource = 'office';
    saveDrawResult(req, result, 'imitate');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `风格模仿生成失败：${e.message}` });
  }
});
// 报告写作：主题 + 结构模板 → 对话模型撰写 → 返回 Markdown 文字报告（不入绘图历史）
app.post('/api/office/report-write', async (req, res) => {
  const p = req.body || {};
  const topic = String(p.topic || '').trim();
  if (!topic) return res.status(400).json({ error: '请填写报告主题' });
  if (topic.length > 2000) return res.status(400).json({ error: '主题过长（限 2000 字）' });
  const structureId = String(p.structure || 'panorama');
  const requirements = String(p.requirements || '').trim().slice(0, 1000);
  const docContent = String(p.docContent || '').trim().slice(0, docparse.MAX_CHARS); // 可选文档素材
  if (!isConfigured()) return res.status(503).json({ error: '未配置对话模型 API Key' });
  try {
    const prompt = office.buildReportWritePrompt(topic, structureId, requirements, docContent);
    const text0 = await llmChat([{ role: 'user', content: prompt }], {
      responseFormat: null, // 自由文本输出（Markdown 报告）
      reasoningEffort: 'none',
      temperature: 0.5,
      maxTokens: 4096,
      timeoutMs: 180000, // 长文写作较慢，放宽超时
    });
    const text = String(text0 || '').trim();
    saveOfficeResult(req, 'write', topic.slice(0, 100), text, 'md'); // 24 小时暂存
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: `报告写作失败：${e.message}` });
  }
});
// 报告网页化：Markdown 报告 → 对话模型创作 → 返回自包含单文件 HTML 专题页（不入绘图历史）
app.post('/api/office/report', async (req, res) => {
  const p = req.body || {};
  const content = String(p.content || '').trim();
  if (!content) return res.status(400).json({ error: '请填写报告内容' });
  if (content.length > 20000) return res.status(400).json({ error: '报告内容过长（限 20000 字）' });
  const styleHint = String(p.style || '').trim().slice(0, 200);
  if (!isConfigured()) return res.status(503).json({ error: '未配置对话模型 API Key' });
  try {
    const prompt = office.buildReportPrompt(content, styleHint);
    // 长文+多表格输入生成耗时可能超过 5 分钟，放宽到 8 分钟；失败（超时/空返回/非 HTML）自动重试一次
    let html = '';
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await llmChat([{ role: 'user', content: prompt }], {
          responseFormat: null, // 自由文本输出（HTML 文档）
          reasoningEffort: 'none',
          temperature: 0.5,
          maxTokens: 8192, // 完整 HTML 页面较长，放宽输出上限（实测 16000 超出模型上限会返回空内容）
          timeoutMs: 480000, // 长文创作较慢，放宽超时（8 分钟）
        });
        // 容错：剥离模型可能包裹的 markdown 代码块围栏
        let h = String(text || '').trim();
        const fence = h.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
        if (fence) h = fence[1].trim();
        if (/^<!DOCTYPE html>/i.test(h)) { html = h; break; }
        console.log(`[报告] 第${attempt + 1}次生成结果非 HTML（长度${h.length}）: ${JSON.stringify(h.slice(0, 300))}`);
        lastErr = null; // 非 HTML 但未抛错，重试
      } catch (e) {
        console.log(`[报告] 第${attempt + 1}次生成失败: ${e.message}`);
        lastErr = e;
      }
    }
    if (!html) {
      if (lastErr) throw lastErr;
      return res.status(502).json({ error: '生成结果不是有效的 HTML 文档，请重试' });
    }
    // 历史标题取首个非空标题行（去掉 # 前缀），避免整段 Markdown 原文进列表
    const reportTitle = (content.split('\n').map((l) => l.trim()).find((l) => l) || '').replace(/^#+\s*/, '').slice(0, 100) || '未命名报告';
    saveOfficeResult(req, 'report', reportTitle, html, 'html'); // 24 小时暂存
    res.json({ html });
  } catch (e) {
    res.status(500).json({ error: `报告生成失败：${e.message}` });
  }
});
// —— PPT 简化版（移植 sn-ppt-story 大纲方法论 + sn-ppt-standard 渲染思路）：主题 → 大纲 → 逐页配图 → 自包含 HTML 幻灯片 ——
app.post('/api/office/ppt', async (req, res) => {
  const p = req.body || {};
  const topic = String(p.topic || '').trim();
  if (!topic) return res.status(400).json({ error: '请填写演示主题' });
  if (topic.length > 2000) return res.status(400).json({ error: '主题内容过长（限 2000 字）' });
  const pageCount = Math.min(Math.max(parseInt(p.pageCount, 10) || 6, 3), 12);
  const withImages = p.withImages !== false; // 默认配图，可关闭（纯文字更快）
  const docContent = String(p.docContent || '').trim().slice(0, docparse.MAX_CHARS); // 可选文档素材（前端先解析预览确认）
  if (!isConfigured()) return res.status(503).json({ error: '未配置对话模型 API Key' });
  try {
    // 第一步：LLM 生成大纲（带思考兜底与重试，复用乱码检测的稳定性防护）
    let slides = [];
    // 页数明显不足（少于要求页数-2，如 12 页只解析出 3 页）视为返回被截断，同样触发重试；跨尝试保留页数最多的结果
    const enough = (n) => n >= Math.max(1, pageCount - 2);
    for (let attempt = 0; attempt < 3 && !enough(slides.length); attempt++) {
      try {
        const text = await llmChat([{ role: 'user', content: office.buildPptOutlinePrompt(topic, pageCount, docContent) }], {
          responseFormat: null,
          reasoningEffort: 'none',
          reasoningFallback: true,
          temperature: 0.4,
          maxTokens: 3000,
          timeoutMs: 120000,
        });
        const parsed = office.parsePptOutline(text, pageCount);
        if (parsed.length > slides.length) slides = parsed;
        console.log(`[PPT] 大纲第${attempt + 1}次: 返回${(text || '').length}字, 解析${parsed.length}页${parsed.length < slides.length ? '（保留更优结果' + slides.length + '页）' : ''}`);
      } catch (e) {
        console.log(`[PPT] 大纲第${attempt + 1}次失败: ${e.message}`);
      }
    }
    if (!slides.length) return res.status(502).json({ error: '大纲生成失败，请重试' });
    // 第二步：逐页配图（复用绘图管线；失败不阻断，该页无图继续）
    const images = [];
    if (withImages && draw.isImageEnabled()) {
      for (let i = 0; i < slides.length; i++) {
        const desc = slides[i].image || slides[i].title;
        try {
          const r = await draw.generate({
            prompt: `演示文稿配图，与『${slides[i].title}』主题相关：${desc}。扁平化矢量插画风格，简洁构图，无文字。`,
            model: 'sensenova-u1.5-lite',
            size: '2720x1536',
            outputFormat: 'webp',
            watermark: false,
            promptExtend: false,
          });
          images.push(r && r.b64s && r.b64s[0] ? 'data:image/webp;base64,' + r.b64s[0] : '');
          console.log(`[PPT] 配图 ${i + 1}/${slides.length}: ${images[i] ? '成功' : '失败'}`);
        } catch (e) {
          images.push('');
          console.log(`[PPT] 配图 ${i + 1}/${slides.length} 失败: ${e.message}`);
        }
      }
    }
    // 第三步：组装自包含 HTML 幻灯片
    const html = office.buildPptHtml(slides, images, topic);
    saveOfficeResult(req, 'ppt', topic.slice(0, 100), html, 'html'); // 24 小时暂存
    res.json({ html, pageCount: slides.length, imageCount: images.filter(Boolean).length });
  } catch (e) {
    console.log('[PPT] 异常:', e.message);
    res.status(500).json({ error: `PPT 生成失败：${e.message}` });
  }
});
// —— 办公历史（报告网页化/演示文稿/报告写作，24 小时暂存，机制仿绘图历史）：文件存 data/office/，元数据入库 ——
const OFFICE_DIR = path.join(__dirname, '..', 'data', 'office');
function saveOfficeResult(req, type, title, content, ext) {
  try {
    const user = userFromRequest(req);
    if (!user || !content) return null;
    fs.mkdirSync(OFFICE_DIR, { recursive: true });
    const id = `of-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = `${id}.${ext}`;
    const buf = Buffer.from(String(content), 'utf8');
    fs.writeFileSync(path.join(OFFICE_DIR, file), buf);
    const now = Date.now();
    storage.db.prepare('INSERT INTO office_history (id, user_id, type, title, file, created_at, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, type, String(title || '').slice(0, 100), file, now, buf.length);
    return id;
  } catch (e) {
    console.log('[办公历史] 保存失败:', e.message);
    return null;
  }
}
function signOfficeFile(userId, name, createdAt) {
  const exp = (Number(createdAt) || Date.now()) + 25 * 60 * 60 * 1000;
  const sig = crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'draw-secret')).update(`${userId}:${name}:${exp}`).digest('hex').slice(0, 32);
  return `/api/office/file/${name}?uid=${userId}&exp=${exp}&sig=${sig}`;
}
function verifyOfficeFileSig(userId, name, exp, sig) {
  if (!userId || !exp || !sig || Number(exp) < Date.now()) return false;
  const expect = crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'draw-secret')).update(`${userId}:${name}:${exp}`).digest('hex').slice(0, 32);
  return expect === sig;
}
// 办公历史列表（自动清理过期记录与文件）
app.get('/api/office/history', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const expired = storage.db.prepare('SELECT file FROM office_history WHERE user_id = ? AND created_at < ?').all(user.id, cutoff);
  for (const e of expired) {
    try { fs.unlinkSync(path.join(OFFICE_DIR, path.basename(e.file))); } catch { /* 文件可能已不存在 */ }
  }
  if (expired.length) storage.db.prepare('DELETE FROM office_history WHERE user_id = ? AND created_at < ?').run(user.id, cutoff);
  const rows = storage.db.prepare('SELECT id, type, title, file, created_at, bytes FROM office_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(user.id);
  res.json({ rows: rows.map((r) => ({ ...r, url: signOfficeFile(user.id, path.basename(r.file), r.created_at) })), ttlHours: 24 });
});
// 办公历史文件读取（HMAC 签名鉴权，同绘图文件机制）
app.get('/api/office/file/:name', (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  const { uid, exp, sig } = req.query;
  if (!verifyOfficeFileSig(String(uid || ''), name, String(exp || ''), String(sig || ''))) {
    return res.status(401).json({ error: '签名无效或已过期' });
  }
  const row = storage.db.prepare('SELECT 1 FROM office_history WHERE user_id = ? AND file = ?').get(String(uid), name);
  if (!row) return res.status(404).json({ error: '文件不存在或已过期' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(OFFICE_DIR, name));
});
// —— 绘图历史（24 小时过期，图片存文件系统仅元数据入库）与提示词历史（持续保留） ——
const DRAW_DIR = path.join(__dirname, '..', 'data', 'draw');
fs.mkdirSync(DRAW_DIR, { recursive: true });
// 历史列表：登录用户自己的记录；查询时惰性清理过期记录与文件
// 图片 URL 带短期签名（2 小时有效）：浏览器 img 标签请求不携带 JWT 头，
// 签名参数让图片访问既保持按用户隔离又可被 img 直接加载
const crypto = require('crypto');
function signDrawFile(userId, name, createdAt) {
  // exp 锚定图片创建时间（而非当前时间）：同一张图片在保留期内 URL 恒定不变，浏览器可按 URL 命中本地缓存
  const exp = (Number(createdAt) || Date.now()) + 25 * 60 * 60 * 1000; // 签名有效期略长于图片保留期（24h）：账号登录拉取列表后，图片未过期就能一直显示
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
    rows: rows.map((r) => ({ ...r, url: signDrawFile(user.id, path.basename(r.file), r.created_at) })),
    ttlHours: 24,
    expiredCount: expired.length, // 本次访问清理的过期图片数量（前端据此提示用户）
  });
});
// 图片访问限速（按 IP，宽松阈值）：每分钟 200 次——正常浏览画廊完全无感，仅拦截脚本狂刷
const imgRate = new Map(); // ip -> { count, windowStart }
const IMG_RATE_LIMIT = 200;
const IMG_RATE_WINDOW_MS = 60 * 1000;
function imgRateAllow(ip) {
  const now = Date.now();
  let rec = imgRate.get(ip);
  if (!rec || now - rec.windowStart >= IMG_RATE_WINDOW_MS) {
    rec = { count: 0, windowStart: now };
    imgRate.set(ip, rec);
  }
  rec.count += 1;
  return rec.count <= IMG_RATE_LIMIT;
}
// 图片文件访问：短期签名校验（img 标签无 JWT 头，靠 URL 签名鉴权；仍按用户隔离）
app.get('/api/draw/file/:name', (req, res) => {
  if (!imgRateAllow(req.ip || 'unknown')) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  const name = path.basename(String(req.params.name || ''));
  const { uid, exp, sig } = req.query;
  if (!verifyDrawFileSig(String(uid || ''), name, String(exp || ''), String(sig || ''))) {
    return res.status(401).json({ error: '签名无效或已过期' });
  }
  const row = storage.db.prepare('SELECT 1 FROM draw_history WHERE user_id = ? AND file = ?').get(String(uid), name);
  if (!row) return res.status(404).json({ error: '图片不存在或已过期' });
  // 允许浏览器本地缓存 24 小时（URL 已确定性签名，保留期内不变）：刷新/重进工作台直接命中缓存，不再回源消耗服务器流量
  res.setHeader('Cache-Control', 'private, max-age=86400');
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
  // 按来源过滤：绘图只看 draw；办公按标签细分（office:infographic / office:resume），旧 office 数据兼容显示
  const raw = String(req.query.source || 'draw');
  const source = raw === 'draw' || raw === 'office' || /^office:[a-z]+$/.test(raw) ? raw : 'draw';
  res.json({ rows: storage.listDrawPrompts(user.id, source) });
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
  // 查库补管理员标记：令牌里只有用户名，刷新页面时前端用本接口恢复登录态——
  // 不补标记的话每次刷新都会冲掉登录时存的管理员标记，管理入口消失（需重新登录才恢复）
  const row = storage.findUserById(user.id);
  res.json({ user: { id: user.id, username: user.username, isAdmin: !!(row && row.is_admin) } });
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

// —— 管理员接口（第一期：用户管理；均需 requireAdmin，且受口令 + JWT 双重保护）——
// 用户列表：用户名、注册时间、存档数、绘图历史数、在线状态、最近活跃、在线历史
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const now = Date.now();
  const rows = storage.listUsersForAdmin().map((u) => ({
    ...u,
    online: now - (lastSeen.get(u.id) || 0) < ONLINE_WINDOW_MS, // 在线状态：最近 5 分钟内有请求
    last_seen: lastSeen.get(u.id) || null, // 最近活跃（本次服务运行期内）
  }));
  res.json({ rows });
});
// 用户在线历史：该用户的历次上线记录（时间 + 时长）
app.get('/api/admin/users/:id/sessions', requireAdmin, (req, res) => {
  const target = storage.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  res.json({ rows: storage.listOnlineSessions(target.id) });
});
// 删除用户：级联删除存档/绘图历史/提示词；禁止删除自己（防止删掉唯一管理员）
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = userFromRequest(req);
  const target = storage.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.id === user.id) return res.status(400).json({ error: '不能删除自己的账号' });
  storage.deleteUserCascade(target.id);
  res.json({ ok: true, deleted: target.username });
});
// 重置用户密码：管理员设置新密码（6-64 位）
app.post('/api/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const target = storage.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const newPwd = String(req.body?.password || '');
  if (newPwd.length < 6 || newPwd.length > 64) return res.status(400).json({ error: '新密码需 6-64 位' });
  storage.adminResetPassword(target.id, hashPassword(newPwd));
  res.json({ ok: true, reset: target.username });
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

app.listen(PORT, HOST, () => {
  console.log(`[文字冒险] 服务已启动: http://${HOST}:${PORT}`);
  console.log(`[文字冒险] LLM 配置状态: ${isConfigured() ? '已配置' : '未配置（请填写 .env）'}`);
  if (isConfigured()) {
    const cfg = llmConfig();
    console.log(`[文字冒险] 模型: ${cfg.model} | 服务: ${cfg.baseUrl}`);
  }
});
