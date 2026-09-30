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
    pendingActions: [], // 前端按钮产生的待结算动作（提交给 AI 前暂存，可撤销）
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
 * 物品操作权限：AI 只能"赠送新物品"（inventory）；消耗/丢弃/换装等物品移动
 * 一律由玩家通过前端按钮完成并自动同步，因此 AI 返回的 removeInventory / weapon / armor 一律忽略。
 */
function normalizeDelta(delta) {
  const out = { hp: 0, gold: 0, exp: 0, inventory: [] };
  if (!delta || typeof delta !== 'object') return out;

  out.hp = Math.round(Number(delta.hp) || 0);
  out.gold = Math.round(Number(delta.gold) || 0);
  out.exp = Math.round(Number(delta.exp) || 0);

  const inv = Array.isArray(delta.inventory) ? delta.inventory : [];
  out.inventory = inv.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

  return out;
}

/**
 * 从背包移除物品，支持带数量的条目（如「干粮 x2」）。
 * 数量由物品名末尾的「 xN」解析；未带数量则完整移除单个条目。
 * @returns {boolean} 是否成功移除
 */
function removeFromInventory(player, effects, itemName) {
  const trimmed = String(itemName || '').trim();
  if (!trimmed) return false;

  // 解析名称与数量：「干粮 x2」→ { name: '干粮', count: 2 }
  const countMatch = trimmed.match(/^(.*?)\s*[x×](\d+)$/i);
  const targetName = (countMatch ? countMatch[1].trim() : trimmed);
  const targetCount = countMatch ? parseInt(countMatch[2], 10) : 1;

  // 装备类（武器/防具）与道具的文案区分
  const isEquip = targetName.startsWith('武器·') || targetName.startsWith('防具·');
  const removePhrase = (n, extra = '') =>
    isEquip ? `背包移除「${n}」${extra}` : `失去「${n}」${extra}`;

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
        effects.push(removePhrase(targetName));
      } else {
        player.inventory[i] = `${entryName} x${newCount}`;
        effects.push(removePhrase(targetName, `x${targetCount}，剩余 x${newCount}`));
      }
    } else {
      // 背包条目不带数量：视为单件，直接移除
      player.inventory.splice(i, 1);
      effects.push(removePhrase(targetName));
    }
    return true;
  }

  // 背包中完全没有（可能是按钮操作已移除的道具被 AI 重复声明移除，静默忽略，不打扰玩家）
  return false;
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
    const { name } = parseItem(item);
    // 武器/防具/道具一律进背包：装备到槽位由玩家通过按钮完成，AI 无权直接装备
    if (player.inventory.length >= MAX_INVENTORY) {
      effects.push(`背包已满，无法获得「${name}」`);
      continue;
    }
    player.inventory.push(item);
    effects.push(`获得「${item}」`);
  }

  return { player, effects };
}

// ==================== 按钮快捷操作（装备/卸下/使用道具） ====================

/**
 * 使用道具：从背包移除，记为待结算动作（效果延迟到下次 AI 回合结算）。
 * @returns {{ok: boolean, pending: object|null, message: string}}
 */
function useItem(game, itemName) {
  const player = game.player;
  const effects = [];
  // 按钮点击默认只使用 1 个：即使条目带数量（如「干粮 x2」）也按 x1 扣减，
  // 想一次用多个可改用文字输入（走 AI 结算流程）。
  const countMatch = String(itemName).match(/^(.*?)\s*[x×](\d+)$/i);
  const useOne = countMatch ? `${countMatch[1].trim()} x1` : String(itemName).trim();
  const ok = removeFromInventory(player, effects, useOne);
  if (!ok) {
    return { ok: false, pending: null, message: `背包里没有「${useOne}」` };
  }
  const pending = { type: 'use', item: useOne, message: `使用「${useOne}」` };
  game.pendingActions.push(pending);
  game.updatedAt = Date.now();
  return { ok: true, pending, message: pending.message };
}

/**
 * 恢复道具到背包（支持数量合并）。
 * 例如背包现有「干粮 x1」，恢复「干粮 x1」→ 合并为「干粮 x2」。
 */
function restoreItem(player, itemName) {
  const countMatch = String(itemName).match(/^(.*?)\s*[x×](\d+)$/i);
  const name = countMatch ? countMatch[1].trim() : String(itemName).trim();
  const count = countMatch ? parseInt(countMatch[2], 10) : 1;

  for (let i = 0; i < player.inventory.length; i++) {
    const entry = player.inventory[i];
    const entryMatch = entry.match(/^(.*?)\s*[x×](\d+)$/i);
    if (entryMatch && entryMatch[1].trim() === name) {
      player.inventory[i] = `${name} x${parseInt(entryMatch[2], 10) + count}`;
      return;
    }
    if (!entryMatch && entry === name) {
      player.inventory[i] = `${name} x${1 + count}`;
      return;
    }
  }
  player.inventory.push(itemName);
}

/**
 * 丢弃背包中的物品（默认丢弃 1 个，与"使用"一致；带数量条目按 x1 扣减），记为待结算动作。
 */
function discardItem(game, itemName) {
  const player = game.player;
  const effects = [];
  const countMatch = String(itemName).match(/^(.*?)\s*[x×](\d+)$/i);
  const discardOne = countMatch ? `${countMatch[1].trim()} x1` : String(itemName).trim();
  const ok = removeFromInventory(player, effects, discardOne);
  if (!ok) {
    return { ok: false, pending: null, message: `背包里没有「${discardOne}」` };
  }
  const pending = { type: 'discard', item: discardOne, message: `丢弃「${discardOne}」` };
  game.pendingActions.push(pending);
  game.updatedAt = Date.now();
  return { ok: true, pending, message: pending.message };
}

/**
 * 撤销待结算动作：恢复道具到背包。
 */
function cancelPendingAction(game, index) {
  const pending = game.pendingActions[index];
  if (!pending) return { ok: false, message: '待结算动作不存在' };
  if (pending.type === 'use' || pending.type === 'discard') {
    restoreItem(game.player, pending.item);
    game.pendingActions.splice(index, 1);
    game.updatedAt = Date.now();
    return { ok: true, message: `已撤销「${pending.type === 'use' ? '使用' : '丢弃'}${pending.item}」，道具已恢复` };
  }
  return { ok: false, message: '该类型动作暂不支持撤销' };
}

/**
 * 装备背包中的武器/防具到对应槽位（立即生效，写入待结算动作供 AI 感知）。
 */
function equipItem(game, itemName) {
  const player = game.player;
  const { type, name } = parseItem(itemName);
  if (type !== 'weapon' && type !== 'armor') {
    return { ok: false, message: `「${name}」不是武器或防具` };
  }
  const slot = type === 'weapon' ? 'weapon' : 'armor';
  const idx = player.inventory.indexOf(itemName);
  if (idx === -1) return { ok: false, message: `背包里没有「${itemName}」` };
  // 卸下当前装备放回背包
  player.inventory.splice(idx, 1);
  if (player[slot]) player.inventory.push(player[slot]);
  player[slot] = itemName;
  game.pendingActions.push({ type: 'equip', item: itemName, message: `装备「${itemName}」` });
  game.updatedAt = Date.now();
  return { ok: true, message: `已装备「${itemName}」` };
}

/**
 * 卸下当前武器/防具到背包（立即生效，写入待结算动作供 AI 感知）。
 */
function unequipItem(game, slot) {
  if (slot !== 'weapon' && slot !== 'armor') return { ok: false, message: '无效的槽位' };
  const player = game.player;
  const current = player[slot];
  if (!current) return { ok: false, message: slot === 'weapon' ? '当前没有装备武器' : '当前没有装备防具' };
  player.inventory.push(current);
  player[slot] = null;
  game.pendingActions.push({ type: 'unequip', slot, item: current, message: `卸下「${current}」` });
  game.updatedAt = Date.now();
  return { ok: true, message: `已卸下「${current}」` };
}

/** 清空待结算动作（提交给 AI 前调用） */
function clearPendingActions(game) {
  game.pendingActions = [];
}

/**
 * 构造给 LLM 的系统提示词。
 */
function buildSystemPrompt(player, history) {
  return `你是「艾泽洛姆」的至高游戏主持人（Game Master），负责驱动一场单人文字冒险 RPG。

【输出格式 — 最高优先级，必须严格遵守】
你的每一次回复都必须是一个【合法且完整】的 JSON 对象，除此之外不允许输出任何其他内容（包括开场的思考、解释、代码块标记、多余的标点或空白行）。JSON 结构唯一，示例如下：
{"narrative":"...","choices":["...","..."],"delta":{"hp":0,"gold":0,"exp":0,"inventory":[]},"battle":false}

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
   - 获得武器/防具/道具 → inventory（武器防具格式见【物品品质规则】；获得后会进入玩家背包，由玩家通过按钮自行装备）
   - 战斗胜利或重要发现 → exp（10~30）
   - 未发生的事件一律填 0、空数组或 null

【物品操作权限（核心规则，必须遵守）】
- 所有物品的移动操作【使用 / 丢弃 / 卸下 / 装备】只能由玩家在界面通过按钮完成，程序会自动同步状态。
- 因此你的 delta 中【不要、也不需要】包含 removeInventory、weapon、armor 这类字段——你无权移动任何物品。
- 玩家通过按钮操作时，输入会以「（已操作：使用「干粮 x1」，卸下「防具·皮甲[普通]」）」的形式提示你：这些动作已经实际生效，你只需在剧情中如实描写，并在 delta 中结算其效果（如食用食物在 hp 填正数）。
- 玩家要求换装备时，请只在剧情中描写他取出/收好装备的意图，装备实际切换由玩家点击按钮完成，你不要在 delta 里替玩家操作。

【道具效果规则（重要）】
- 道具没有预设效果表，效果完全由你根据道具性质自主决定并如实填写在 delta 中（道具的移除动作已由玩家按钮完成，你只管效果）：
  - 玩家食用食物/饮水/使用回复类道具（干粮、面包、药水、草药、药剂、果实等）→ 在 hp 中填正数（回复 5~40，与道具价值相符；大餐/稀有药剂可回复更多）
  - 玩家使用有毒/腐败/危险道具 → 在 hp 中填负数
  - 玩家使用增益道具（增益临时力量等）→ 在 exp 中填正数（10~30）或视情况在 hp/gold 体现
  - 玩家使用照明/工具类道具（火把、绳索等）→ 无属性变化，效果留空即可
- 关键：只要玩家使用了道具，就必须在 hp/gold/exp 中如实反映其效果（无效果的工具类除外）。宁可高估效果，也不要漏写——漏写会让玩家产生「吃了东西却没反应」的困惑。
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

  // 0. 若存在待结算的按钮动作（使用道具/换装/卸装），合并进玩家输入一并提交给 AI
  let mergedInput = userInput;
  if (game.pendingActions && game.pendingActions.length) {
    const pendingDesc = game.pendingActions.map((p) => `（动作：${p.message}）`).join('，');
    mergedInput = `${userInput}。此前你已通过快捷按钮执行：${pendingDesc}，请根据这些已发生的动作推进剧情并结算其效果（使用道具的效果由你决定，如食物回血等；已在背包中移除的消耗品不要重复移除）。`;
    clearPendingActions(game);
  }

  // 1. 追加玩家输入到历史
  history.push({ role: 'user', content: mergedInput });

  // 2. 调用 LLM
  const system = buildSystemPrompt(game.player, history);
  const text = await chat([
    { role: 'system', content: system },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ], { temperature: 0.9, maxTokens: 4096 });

  // 3. 解析动作 JSON
  let action = parseActionJson(text);

  // 3.1 解析失败：用精简提示词自动重试一次，尽量引导模型输出 JSON
  if (action === null) {
    console.log('[debug] 首次解析失败，尝试重试…');
    try {
      const retryPrompt = `你是一个文字冒险游戏主持人，请严格以 JSON 格式输出本回合结果，不要输出任何其他文字。必须使用如下格式：
{"narrative":"200~400字剧情，第二人称，承接上回合", "choices":["选项1","选项2"], "delta":{"hp":0,"gold":0,"exp":0,"inventory":[]}, "battle":false}
武器命名「武器·名称[品质]」、防具命名「防具·名称[品质]」（品质：普通/优秀/稀有/史诗/传说），道具无前缀；获得物品填 inventory（进入背包，装备由玩家按钮完成），你无权移除或换装任何物品。玩家状态：
${renderPlayer(game.player)}`;
      const retryMessages = [{ role: 'system', content: retryPrompt }, { role: 'user', content: `上一回合玩家行动：${history[history.length - 1]?.content}\n请继续推进剧情。` }];
      const retryText = await chat(retryMessages, { temperature: 0.9, maxTokens: 4096 });
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

module.exports = { newGame, processAction, renderPlayer, buildSystemPrompt, useItem, discardItem, cancelPendingAction, equipItem, unequipItem, clearPendingActions };
