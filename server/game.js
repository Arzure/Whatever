const { chat } = require('./llm');

// 训练限制常量
const MAX_HP = 100;
const MIN_HP = 0;
const MAX_INVENTORY = 20;

/**
 * 初始化新游戏。
 * @param {string} playerName 冒险者名字
 */
function newGame(playerName) {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    player: {
      name: playerName || '无名冒险者',
      hp: 100,
      maxHp: MAX_HP,
      gold: 10,
      level: 1,
      exp: 0,
      inventory: ['旧铁剑', '皮甲', '干粮 x2'],
      equipped: '旧铁剑',
    },
    history: [],
  };
}

/**
 * 将玩家信息渲染成给 LLM 看的角色面板文本。
 */
function renderPlayer(player) {
  return [
    `- 姓名：${player.name}`,
    `- 等级：${player.level}，经验：${player.exp}`,
    `- 生命：${player.hp}/${player.maxHp}`,
    `- 金币：${player.gold}`,
    `- 装备：${player.equipped}`,
    `- 背包：${player.inventory.length ? player.inventory.join('、') : '（空空如也）'}`,
  ].join('\n');
}

/**
 * 严格解析 LLM 返回的动作 JSON，出错时抛异常。
 * @param {string} text LLM 原始输出
 */
function parseActionJson(text) {
  const trimmed = text.trim();
  // 兼容 LLM 输出被 markdown 代码块包裹的情况
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;

  // 尝试提取第一个 {...} 块
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM 输出中没有找到 JSON 对象');
  }

  const obj = JSON.parse(raw.slice(start, end + 1));
  if (typeof obj !== 'object' || obj === null) throw new Error('解析结果不是对象');
  return obj;
}

/**
 * 校验并规范化 LLM 返回的 delta（属性变化）。
 */
function normalizeDelta(delta) {
  const out = { hp: 0, gold: 0, exp: 0, inventory: [], removeInventory: [] };
  if (!delta || typeof delta !== 'object') return out;

  out.hp = Math.round(Number(delta.hp) || 0);
  out.gold = Math.round(Number(delta.gold) || 0);
  out.exp = Math.round(Number(delta.exp) || 0);

  const inv = Array.isArray(delta.inventory) ? delta.inventory : [];
  out.inventory = inv.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

  const rm = Array.isArray(delta.removeInventory) ? delta.removeInventory : [];
  out.removeInventory = rm.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

  return out;
}

/**
 * 应用 delta 到玩家状态，返回 { player, effects: string[] }。
 * effects 用于在剧情文本中附加"获得了 XX""生命 -5"等短提示。
 */
function applyDelta(player, delta) {
  const effects = [];

  if (delta.hp !== 0) {
    player.hp = Math.max(MIN_HP, Math.min(MAX_HP, player.hp + delta.hp));
    effects.push(delta.hp > 0 ? `生命 +${delta.hp}` : `生命 ${delta.hp}`);
  }
  if (delta.gold !== 0) {
    player.gold = Math.max(0, player.gold + delta.gold);
    effects.push(delta.gold > 0 ? `金币 +${delta.gold}` : `金币 ${delta.gold}`);
  }
  if (delta.exp !== 0) {
    player.exp += delta.exp;
    while (player.exp >= player.level * 100) {
      player.exp -= player.level * 100;
      player.level += 1;
      player.maxHp = Math.min(MAX_HP, player.maxHp + 10);
      player.hp = Math.min(player.maxHp, player.hp + 20);
      effects.push(`升级！等级提升到 ${player.level}`);
    }
  }

  for (const item of delta.inventory) {
    if (player.inventory.length >= MAX_INVENTORY) {
      effects.push(`背包已满，无法获得「${item}」`);
      continue;
    }
    player.inventory.push(item);
    effects.push(`获得「${item}」`);
  }

  for (const item of delta.removeInventory) {
    const idx = player.inventory.indexOf(item);
    if (idx !== -1) {
      player.inventory.splice(idx, 1);
      effects.push(`失去「${item}」`);
    } else if (player.equipped === item) {
      player.equipped = '徒手';
      effects.push(`失去「${item}」（已卸下装备）`);
    }
  }

  return { player, effects };
}

/**
 * 构造给 LLM 的系统提示词。
 */
function buildSystemPrompt(player, history) {
  return `你是「艾泽洛姆」的至高游戏主持人（Game Master），负责驱动一场单人文字冒险 RPG。

游戏规则：
1. 你只输出 JSON，绝不输出其他文字。JSON 结构如下：
{
  "narrative": "本回合的剧情叙述，300~500字，中文，用第二人称「你」描述，扣人心弦且符合世界观，结尾不要替玩家做决定",
  "choices": ["建议选项A", "建议选项B", "建议选项C"],
  "delta": { "hp": 0, "gold": 0, "exp": 0, "inventory": ["获得的物品"], "removeInventory": ["失去的物品"] },
  "battle": true 或 false
}
2. "narrative" 必须自然承接上一回合剧情，并且明确反映玩家本回合的行动结果。
3. "choices" 给出 2~3 个符合当前情境的可选行动建议（玩家的"动作"输入可自由发挥，不受选项限制）。
4. "delta" 严格根据本回合实际发生的事件填写：
   - 受到伤害/治疗 → hp（负数为受伤，正数为治疗，幅度 5~40，贴合情节）
   - 获得/失去金币 → gold（幅度 1~50）
   - 获得/失去物品 → inventory / removeInventory（物品名必须和前后剧情一致，且 removeInventory 中的名字要与玩家现有背包里的名称完全一致）
   - 战斗胜利或重要发现 → exp（10~30）
   - 未发生的事一律填 0 或空数组
5. "battle"：本回合如果玩家正处于战斗状态，填 true，否则 false。
6. 不要代替玩家做出决定性的动作（比如玩家没有说要逃跑，就不要直接写"你逃走了"）。玩家的自由行动都要给予合理的结果。
7. 如果玩家的行动会直接导致死亡（如 hp 降到 0 以下），delta.hp 应恰好使生命降到 0，并描写死亡结局，此时游戏结束。若 hp 归零，后续回合不再生成剧情。

世界观：中世纪奇幻大陆「艾泽洛姆」。世界里有龙、精灵、兽人、遗迹、瘟疫、财宝与阴谋。玩家是一名初出茅庐的冒险者，故事从这里开始。

玩家当前状态：
${renderPlayer(player)}

最近剧情回顾（供你保持连贯性）：
${history.length ? history.slice(-6).map((h) => `[${h.role === 'user' ? '玩家' : '旁白'}] ${h.content}`).join('\n') : '（无）'}`;
}

/**
 * 核心动作处理：把玩家输入交给 LLM，解析并应用结果。
 * @returns {Promise<{narrative, choices, battle, effects, player, history, gameOver}>}
 */
async function processAction(game, userInput) {
  const history = game.history;

  // 1. 追加玩家输入到历史
  history.push({ role: 'user', content: userInput });

  // 2. 调用 LLM
  const system = buildSystemPrompt(game.player, history);
  const text = await chat([
    { role: 'system', content: system },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ], { temperature: 0.9, maxTokens: 1200 });

  // 3. 解析动作 JSON
  let action;
  try {
    action = parseActionJson(text);
  } catch (err) {
    throw new Error(`AI 返回了无法解析的内容，请重试一次。原始内容：${text.slice(0, 200)}`);
  }

  // 4. 应用状态变化
  const delta = normalizeDelta(action.delta);
  const { player, effects } = applyDelta(game.player, delta);

  // 5. 追加旁白到历史（截断过长内容，防止历史膨胀），并持久化推荐选项
  const narrative = String(action.narrative || '（AI 未返回剧情）').slice(0, 2000);
  const choices = Array.isArray(action.choices) ? action.choices.slice(0, 3).map(String) : [];
  history.push({ role: 'assistant', content: narrative, choices });
  if (history.length > 40) history.splice(0, history.length - 40);

  // 6. 判断游戏结束
  const gameOver = player.hp <= 0;

  game.player = player;
  game.updatedAt = Date.now();

  return {
    narrative,
    choices,
    battle: !!action.battle,
    effects,
    player,
    gameOver,
  };
}

module.exports = { newGame, processAction, renderPlayer };
