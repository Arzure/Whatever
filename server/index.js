const express = require('express');
const path = require('path');
const { loadEnv } = require('./config');
const { isConfigured, llmConfig } = require('./llm');
const storage = require('./storage');
const themes = require('./themes');
const casegen = require('./casegen');
const { getMode, listModes, DEFAULT_MODE } = require('./modes');

loadEnv();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '64kb' }));

// 极简 CORS（开发环境 Vite 在 5173 端口）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/** 加载存档并解析其模式；失败时已写出响应，返回 null */
function findGame(req, res) {
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

// 存档列表
app.get('/api/saves', (req, res) => {
  res.json(storage.listSaves());
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

  let game;
  try {
    // newGame 可能是异步的（探案模式需调用 LLM 生成案件）
    game = await mode.newGame(name, { theme, genre });
  } catch (err) {
    // 需要调用 LLM 的开局失败属于上游错误，其余归为参数错误
    return mode.needsLLM
      ? res.status(502).json({ error: `开局失败：${err.message}` })
      : res.status(400).json({ error: err.message });
  }
  storage.saveGame(game.id, game);
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

// 存档（手动保存，返回当前快照）
app.post('/api/games/:id/save', (req, res) => {
  const found = findGame(req, res);
  if (!found) return;
  found.game.updatedAt = Date.now();
  storage.saveGame(found.game.id, found.game);
  res.json({ ok: true });
});

// 删除存档
app.delete('/api/games/:id', (req, res) => {
  storage.deleteGame(req.params.id);
  res.json({ ok: true });
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
