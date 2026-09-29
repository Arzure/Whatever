const express = require('express');
const path = require('path');
const { loadEnv } = require('./config');
const { isConfigured, llmConfig } = require('./llm');
const storage = require('./storage');
const { newGame, processAction } = require('./game');

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

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, llm: isConfigured() });
});

// 存档列表
app.get('/api/saves', (req, res) => {
  res.json(storage.listSaves());
});

// 新建游戏
app.post('/api/games', (req, res) => {
  const name = String(req.body?.playerName || '').trim().slice(0, 20);
  const game = newGame(name);
  storage.saveGame(game.id, game);
  res.status(201).json({ id: game.id, player: game.player, history: game.history });
});

// 读取存档
app.get('/api/games/:id', (req, res) => {
  const game = storage.loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: '存档不存在' });
  res.json({ id: game.id, player: game.player, history: game.history });
});

// 存档（手动静默保存，返回当前快照）
app.post('/api/games/:id/save', (req, res) => {
  const game = storage.loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: '存档不存在' });
  game.updatedAt = Date.now();
  storage.saveGame(game.id, game);
  res.json({ ok: true });
});

// 删除存档
app.delete('/api/games/:id', (req, res) => {
  storage.deleteGame(req.params.id);
  res.json({ ok: true });
});

// 执行动作（核心游戏循环）
app.post('/api/games/:id/action', async (req, res) => {
  const game = storage.loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: '存档不存在' });

  if (game.player.hp <= 0) {
    return res.status(409).json({ error: '角色已经死亡，游戏结束', gameOver: true });
  }

  const input = String(req.body?.action || '').trim().slice(0, 200);
  if (!input) return res.status(400).json({ error: '动作不能为空' });

  if (!isConfigured()) {
    return res.status(503).json({
      error: '后端未配置 LLM API。请在项目根目录创建 .env 文件，填写 LLM_API_KEY（与 LLM_BASE_URL、LLM_MODEL）后重启服务。',
    });
  }

  try {
    const result = await processAction(game, input);
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
  console.log(`[艾泽洛姆] 服务已启动: http://localhost:${PORT}`);
  console.log(`[艾泽洛姆] LLM 配置状态: ${isConfigured() ? '已配置' : '未配置（请填写 .env）'}`);
  if (isConfigured()) {
    const cfg = llmConfig();
    console.log(`[艾泽洛姆] 模型: ${cfg.model} | 服务: ${cfg.baseUrl}`);
  }
});
