const { chat } = require('./llm');
const { parseItem, renderEquipment, renderInventory } = require('./quality');

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
      inventory: ['干粮 x2'],
      weapon: '武器·旧铁剑[普通]',
      armor: '防具·皮甲[普通]',
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
    renderEquipment(player.weapon, player.armor),
    `- 背包：${renderInventory(player.inventory)}`,
  ].join('\n');
}

/**
 * 解析 LLM 返回的动作 JSON。
 * 兼容 markdown 代码块包裹的情况；若输出中不包含合法 JSON（如模型输出了纯文本剧情），返回 null。
 * @param {string} text LLM 原始输出
 * @returns {object|null}
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
    return null; // 纯文本，无 JSON 对象
  }

  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    return typeof obj === 'object' && obj !== null ? obj : null;
  } catch (e) {
    return null; // JSON 非法
  }
}

/**
 * 校验并规范化 LLM 返回的 delta（属性变化）。
 */
function normalizeDelta(delta) {
  const out = { hp: 0, gold: 0, exp: 0, inventory: [], removeInventory: [], weapon: null, armor: null };
  if (!delta || typeof delta !== 'object') return out;

  out.hp = Math.round(Number(delta.hp) || 0);
  out.gold = Math.round(Number(delta.gold) || 0);
  out.exp = Math.round(Number(delta.exp) || 0);
  out.weapon = typeof delta.weapon === 'string' && delta.weapon.trim() ? delta.weapon.trim() : null;
  out.armor = typeof delta.armor === 'string' && delta.armor.trim() ? delta.armor.trim() : null;

  const inv = Array.isArray(delta.inventory) ? delta.inventory : [];
  out.inventory = inv.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

  const rm = Array.isArray(delta.removeInventory) ? delta.removeInventory : [];
  out.removeInventory = rm.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

  return out;
}

/**
 * 从背包移除物品，支持带数量的条目（如「干粮 x2」）。
 * 数量由物品名末尾的「 xN」解析；未带数量则完整移除单个条目。
 * 找不到同名物品时，宁可不删也不误伤其他物品。
 */
function removeFromInventory(player, effects, itemName) {
  const trimmed = String(itemName || '').trim();
  if (!trimmed) return;

  // 解析名称与数量：「干粮 x2」→ { name: '干粮', count: 2 }
  const countMatch = trimmed.match(/^(.*?)\s*[x×](\d+)$/i);
  const targetName = (countMatch ? countMatch[1].trim() : trimmed);
  const targetCount = countMatch ? parseInt(countMatch[2], 10) : 1;

  // 在背包中查找同名条目
  for (let i = 0; i < player.inventory.length; i++) {
    const entry = player.inventory[i];
    const entryMatch = entry.match(/^(.*?)\s*[x×](\d+)$/i);
    const entryName = entryMatch ? entryMatch[1].trim() : entry;
    if (entryName !== targetName) continue;

    if (entryMatch && entryMatch[2] !== undefined) {
      // 背包条目带数量：扣减
      const newCount = parseInt(entryMatch[2], 10) - targetCount;
      if (newCount <= 0) {
        player.inventory.splice(i, 1);
        effects.push(`失去「${targetName}」`);
      } else {
        player.inventory[i] = `${entryName} x${newCount}`;
        effects.push(`失去「${targetName}」x${targetCount}，剩余 x${newCount}`);
      }
    } else {
      // 背包条目不带数量：视为单件，直接移除
      player.inventory.splice(i, 1);
      effects.push(`失去「${targetName}」`);
    }
    return;
  }

  // 背包中完全没有
  effects.push(`失去「${targetName}」（但背包中没有，可能已丢弃）`);
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
    const { type, name } = parseItem(item);
    if (type === 'weapon' || type === 'armor') {
      // 武器/防具：直接装备到对应槽位（旧装备放回背包）
      const slot = type === 'weapon' ? 'weapon' : 'armor';
      if (player[slot]) {
        player.inventory.push(player[slot]);
        effects.push(`卸下「${parseItem(player[slot]).name}」，放回背包`);
      }
      player[slot] = item;
      effects.push(`装备「${name}」`);
    } else {
      // 道具：进背包
      if (player.inventory.length >= MAX_INVENTORY) {
        effects.push(`背包已满，无法获得「${item}」`);
        continue;
      }
      player.inventory.push(item);
      effects.push(`获得「${item}」`);
    }
  }

  for (const item of delta.removeInventory) {
    removeFromInventory(player, effects, item);
  }

  // 装备切换（AI 指定目标装备）
  // 目标可能来自：a) 背包中的旧装备（玩家要求换装）；b) 本回合剧情刚获得（AI 在叙事中给了装备但忘了写进 inventory）
  // 两种情况都应成功装备：背包有则从背包取，背包没有则视为剧情直接获得，保证剧情与状态一致。
  const switchSlot = (slot, target) => {
    if (!target) return;
    const { type, name } = parseItem(target);
    if (slot === 'weapon' && type !== 'weapon') {
      effects.push(`装备失败：「${name}」不是武器`);
      return;
    }
    if (slot === 'armor' && type !== 'armor') {
      effects.push(`装备失败：「${name}」不是防具`);
      return;
    }
    // 目标已是当前槽位装备：AI 重复声明切换时静默跳过，不重复报错
    if (player[slot] === target) return;
    const idx = player.inventory.indexOf(target);
    if (idx !== -1) player.inventory.splice(idx, 1); // 从背包移除（若是背包已有装备）
    // 卸下当前装备放回背包，再换上目标
    if (player[slot]) player.inventory.push(player[slot]);
    player[slot] = target;
    effects.push(`装备「${name}」`);
  };
  switchSlot('weapon', delta.weapon);
  switchSlot('armor', delta.armor);

  return { player, effects };
}

/**
 * 构造给 LLM 的系统提示词。
 */
function buildSystemPrompt(player, history) {
  return `你是「艾泽洛姆」的至高游戏主持人（Game Master），负责驱动一场单人文字冒险 RPG。

【输出格式 — 最高优先级，必须严格遵守】
你的每一次回复都必须是一个【合法且完整】的 JSON 对象，除此之外不允许输出任何其他内容（包括开场的思考、解释、代码块标记、多余的标点或空白行）。JSON 结构唯一，示例如下：
{"narrative":"...","choices":["...","..."],"delta":{"hp":0,"gold":0,"exp":0,"inventory":[],"removeInventory":[],"weapon":null,"armor":null},"battle":false}

【严格禁止】
- 严禁输出纯文本、散文、对话式回复或剧情片段 —— 即使玩家输入触发你「想直接描写」，你也必须先构造 JSON 对象，把全部剧情写进 narrative 字段。
- 严禁在 JSON 前后添加代码块标记（反引号）、逗号、引号或任何解释性文字。
- 严禁输出两个 JSON 或截断的 JSON；narrative 中禁止出现换行符之外的转义问题，整个响应必须以 { 开始、以 } 结束。
- 如果上一回合你或任何历史消息中存在不符合以上格式的内容，请忽略它们，只按本格式回复。

【字段填写规则】
1. "narrative"：本回合剧情，300~500字，中文，第二人称「你」，紧扣世界观，明确反映玩家本回合行动的结果，结尾不要替玩家做决定。
2. "choices"：2~3 个符合当前情境的可选行动建议（玩家输入可自由发挥，不受选项限制）。
3. "delta"：严格按本回合实际发生的事件填写：
   - 受伤/治疗 → hp（负数受伤、正数治疗，幅度 5~40）
   - 获得/失去金币 → gold（幅度 1~50）
   - 获得武器/防具 → inventory（格式见【物品品质规则】；会直接装备到对应槽位）
   - 获得道具（干粮/药水等）→ inventory
   - 失去道具 → removeInventory（名称须与玩家背包完全一致）
   - 战斗胜利或重要发现 → exp（10~30）
   - 玩家要求更换武器/防具时 → weapon / armor（填玩家背包中已有的完整物品名，含类型前缀与品质标记；程序会自动换装）
   - 未发生的事件一律填 0、空数组或 null
4. "battle"：本回合处于战斗状态填 true，否则 false。

【物品品质规则】
- 物品分为三类，命名必须带类型前缀与品质标记：
  - 武器：「武器·名称[品质]」，如 武器·短刃[稀有]
  - 防具：「防具·名称[品质]」，如 防具·皮甲[优秀]
  - 道具：无前缀无品质，如 干粮 x2、治疗药水
- 品质等级从低到高：普通 < 优秀 < 稀有 < 史诗 < 传说。示例：短刃[稀有]、龙鳞甲[传说]。
- 同一名称不同品质是不同物品，如「武器·短刃[普通]」和「武器·短刃[稀有]」不能混用；玩家当前武器/防具与背包中的物品名必须保持原样（含前缀与品质标记）。
- 获得战利品时按来源的稀有度分配品质：小怪掉落多为[普通]/[优秀]，精英/宝箱可得[稀有]/[史诗]，Boss/遗迹核心可得[传说]。
- 品质越高威力/防护越强：战斗叙事中，高品质武器应体现更强的杀伤力（如[传说]武器可一击重创，[普通]武器只能轻微擦伤）。

【剧情原则】
5. 不要代替玩家做出决定性动作（玩家没说逃跑，就不要写"你逃走了"）；玩家自由行动都要给予合理结果。
6. 玩家行动导致死亡（hp 将降到 0 以下）时，delta.hp 应恰好使生命归 0，并描写死亡结局，游戏结束；hp 归零后不再生成剧情。

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
  ], { temperature: 0.9, maxTokens: 2048 });

  // 3. 解析动作 JSON
  let action = parseActionJson(text);

  // 3.1 解析失败：用精简提示词自动重试一次，尽量引导模型输出 JSON
  if (action === null) {
    console.log('[debug] 首次解析失败，尝试重试…');
    try {
      const retryPrompt = `你是一个文字冒险游戏主持人，请严格以 JSON 格式输出本回合结果，不要输出任何其他文字。必须使用如下格式：
{"narrative":"200~400字剧情，第二人称，承接上回合", "choices":["选项1","选项2"], "delta":{"hp":0,"gold":0,"exp":0,"inventory":[],"removeInventory":[],"weapon":null,"armor":null}, "battle":false}
武器命名「武器·名称[品质]」、防具命名「防具·名称[品质]」（品质：普通/优秀/稀有/史诗/传说），道具无前缀；玩家要求换装时在 weapon/armor 填背包中的完整物品名。玩家状态：
${renderPlayer(game.player)}`;
      const retryMessages = [{ role: 'system', content: retryPrompt }, { role: 'user', content: `上一回合玩家行动：${history[history.length - 1]?.content}\n请继续推进剧情。` }];
      const retryText = await chat(retryMessages, { temperature: 0.9, maxTokens: 2048 });
      action = parseActionJson(retryText);
      console.log('[debug] 重试结果:', action === null ? '仍失败' : '成功');
    } catch (e) {
      console.log('[debug] 重试请求异常:', e.message.slice(0, 60));
      action = null;
    }
  }

  // 3.2 重试后仍无法解析（模型固执地输出纯文本剧情）→ 降级接续，不打断游戏
  if (action === null) {
    const narrative = String(text).trim().slice(0, 2000);
    if (!narrative) throw new Error('AI 返回了空内容，请重试一次');
    history.push({ role: 'assistant', content: narrative, choices: [] });
    if (history.length > 40) history.splice(0, history.length - 40);
    game.updatedAt = Date.now();
    return {
      narrative,
      choices: [],
      battle: false,
      effects: [],
      player: game.player,
      gameOver: game.player.hp <= 0,
      degraded: true, // 标记：AI 未按格式输出，已自动接续（前端用游戏内语言提示）
    };
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

module.exports = { newGame, processAction, renderPlayer, buildSystemPrompt };
