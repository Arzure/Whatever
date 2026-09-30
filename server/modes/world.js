const path = require('path');
const { renderInventory, parseItem } = require('../quality');
const {
  runTurn,
  removeFromInventory,
  restoreItem,
  useItem,
  discardItem,
  equipItem,
  unequipItem,
  cancelPendingAction,
  clearPendingActions,
} = require('../engine');

/**
 * 大世界模式：由「世界观配置（Theme）」驱动的自由探索文字冒险。
 * - 同一套引擎适配任意世界：是否战斗、是否有武器防具、启用哪些数值，全部由 theme.capabilities 决定。
 * - 物品移动（使用/丢弃/装备/卸下）一律由玩家按钮完成，AI 无权移动物品，只负责结算效果。
 */

const MIN_HP = 0;
const MAX_INVENTORY = 20;

/**
 * 初始化一局大世界游戏。
 * @param {string} playerName 冒险者名字
 * @param {{ theme: object }} opts 世界观配置
 */
function newGame(playerName, opts = {}) {
  const theme = opts.theme;
  if (!theme) throw new Error('缺少世界观配置');

  const caps = theme.capabilities || {};
  const ss = theme.startState || {};

  // 槽位：以 capabilities.slots 为准，从 startState.slots 取初始装备
  const slots = {};
  for (const s of caps.slots || []) slots[s.id] = (ss.slots && ss.slots[s.id]) || null;

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: 'world',
    theme,
    player: {
      name: playerName || '无名冒险者',
      hp: Number(ss.hp) || 100,
      maxHp: Number(ss.maxHp) || Number(ss.hp) || 100,
      gold: Number(ss.gold) || 0,
      level: Number(ss.level) || 1,
      exp: Number(ss.exp) || 0,
      inventory: Array.isArray(ss.inventory) ? [...ss.inventory] : [],
      slots,
    },
    history: [],
    pendingActions: [],
  };
}

/**
 * 将玩家信息渲染成给 LLM 看的角色面板文本（按世界观启用的数值与槽位动态裁剪）。
 */
function renderPlayer(player, theme) {
  const caps = theme.capabilities;
  const schema = caps.statSchema;
  const lines = [`- 姓名：${player.name}`];
  if (schema.includes('exp')) lines.push(`- 等级：${player.level}，经验：${player.exp}`);
  if (schema.includes('hp')) lines.push(`- 生命：${player.hp}/${player.maxHp}`);
  if (schema.includes('gold')) lines.push(`- 金币：${player.gold}`);
  for (const s of caps.slots) {
    lines.push(`- ${s.label}：${(player.slots && player.slots[s.id]) || '无'}`);
  }
  if (caps.itemCategories.includes('item')) {
    lines.push(`- 背包：${renderInventory(player.inventory)}`);
  }
  return lines.join('\n');
}

/** 组装 delta 的 JSON 示例片段（只含世界观启用的字段） */
function buildDeltaExample(theme) {
  const schema = theme.capabilities.statSchema;
  const parts = [];
  if (schema.includes('hp')) parts.push('"hp":0');
  if (schema.includes('gold')) parts.push('"gold":0');
  if (schema.includes('exp')) parts.push('"exp":0');
  parts.push('"inventory":[]');
  return `{${parts.join(',')}}`;
}

/** 该世界观是否存在武器/防具概念 */
function hasGear(theme) {
  return theme.capabilities.itemCategories.includes('weapon') || theme.capabilities.itemCategories.includes('armor');
}

/**
 * 构造给 LLM 的系统提示词（按世界观 capabilities 动态生成）。
 */
function buildSystemPrompt(player, history, theme) {
  const caps = theme.capabilities;
  const schema = caps.statSchema;
  const sections = [];

  sections.push(`你是「${theme.name}」的至高游戏主持人（Game Master），负责驱动一场单人文字冒险 RPG。`);

  // —— 输出格式（最高优先级）——
  const deltaExample = buildDeltaExample(theme);
  const example = `{"narrative":"...","choices":["...","..."],"delta":${deltaExample}${caps.hasCombat ? ',"battle":false' : ''}}`;
  sections.push(
    `【输出格式 — 最高优先级，必须严格遵守】\n` +
    `你的每一次回复都必须是一个【合法且完整】的 JSON 对象，除此之外不允许输出任何其他内容（包括开场的思考、解释、代码块标记、多余的标点或空白行）。JSON 结构唯一，示例如下：\n` +
    example
  );

  sections.push(
    `【严格禁止】\n` +
    `- 严禁输出纯文本、散文、对话式回复或剧情片段 —— 即使玩家输入触发你「想直接描写」，你也必须先构造 JSON 对象，把全部剧情写进 narrative 字段。\n` +
    `- 严禁在 JSON 前后添加代码块标记（反引号）、逗号、引号或任何解释性文字。\n` +
    `- 严禁输出两个 JSON 或截断的 JSON；整个响应必须以 { 开始、以 } 结束。`
  );

  // —— 字段填写规则（按启用数值裁剪）——
  const deltaRules = [];
  if (schema.includes('hp')) deltaRules.push('受伤/治疗 → hp（负数受伤、正数治疗，幅度 5~40）');
  if (schema.includes('gold')) deltaRules.push('获得/失去金币 → gold（幅度 1~50）');
  if (caps.itemCategories.length) {
    deltaRules.push(
      hasGear(theme)
        ? '获得武器/防具/道具 → inventory（武器防具格式见【物品品质规则】；获得后会进入玩家背包，由玩家通过按钮自行装备）'
        : '获得物品 → inventory（获得后会进入玩家背包）'
    );
  }
  if (schema.includes('exp')) deltaRules.push('战斗胜利或重要发现 → exp（10~30）');
  deltaRules.push('未发生的事件一律填 0、空数组或 null');

  let fieldRules =
    `【字段填写规则】\n` +
    `1. "narrative"：本回合剧情，300~500字，中文，第二人称「你」，紧扣世界观，明确反映玩家本回合行动的结果，结尾不要替玩家做决定。\n` +
    `2. "choices"：2~3 个符合当前情境的可选行动建议（玩家输入可自由发挥，不受选项限制）。\n` +
    `3. "delta"：严格按本回合实际发生的事件填写：\n` +
    deltaRules.map((r) => `   - ${r}`).join('\n');
  if (caps.hasCombat) {
    fieldRules += `\n4. "battle"：本回合处于战斗状态填 true，否则 false。`;
  }
  sections.push(fieldRules);

  // —— 物品操作权限 ——
  if (caps.itemCategories.length) {
    sections.push(
      `【物品操作权限（核心规则，必须遵守）】\n` +
      `- 所有物品的移动操作【使用 / 丢弃 / 卸下 / 装备】只能由玩家在界面通过按钮完成，程序会自动同步状态。\n` +
      `- 因此你的 delta 中【不要、也不需要】包含 removeInventory、weapon、armor 这类字段——你无权移动任何物品。\n` +
      `- 玩家通过按钮操作时，输入会以「（已操作：使用「干粮 x1」，卸下「${caps.slots[0] ? caps.slots[0].label + '·皮甲[普通]' : '装备'}」）」的形式提示你：这些动作已经实际生效，你只需在剧情中如实描写，并在 delta 中结算其效果（如食用食物在 hp 填正数）。\n` +
      `- 玩家要求换装备时，请只在剧情中描写他取出/收好装备的意图，装备实际切换由玩家点击按钮完成，你不要在 delta 里替玩家操作。`
    );
  }

  // —— 道具效果规则 ——
  if (caps.itemCategories.includes('item')) {
    const hpRule = schema.includes('hp')
      ? '在 hp 中填正数（回复 5~40，与道具价值相符；大餐/稀有药剂可回复更多）'
      : '在剧情中体现恢复效果';
    sections.push(
      `【道具效果规则（重要）】\n` +
      `- 道具没有预设效果表，效果完全由你根据道具性质自主决定并如实填写在 delta 中（道具的移除动作已由玩家按钮完成，你只管效果）：\n` +
      `  - 玩家食用食物/饮水/使用回复类道具（干粮、面包、药水、草药、果实等）→ ${hpRule}\n` +
      `  - 玩家使用有毒/腐败/危险道具 → ${schema.includes('hp') ? '在 hp 中填负数' : '在剧情中体现负面后果'}\n` +
      `  - 玩家使用增益道具 → ${schema.includes('exp') ? '在 exp 中填正数（10~30）' : '在剧情中体现增益'}\n` +
      `  - 玩家使用照明/工具类道具（火把、绳索等）→ 无属性变化，效果留空即可\n` +
      `- 关键：只要玩家使用了道具，就必须如实反映其效果（无效果的工具类除外）。宁可高估效果，也不要漏写——漏写会让玩家产生「吃了东西却没反应」的困惑。`
    );
  }

  // —— 物品品质规则 ——
  if (hasGear(theme)) {
    sections.push(
      `【物品品质规则】\n` +
      `- 物品分为三类，命名必须带类型前缀与品质标记：\n` +
      `  - 武器：「武器·名称[品质]」，如 武器·短刃[稀有]\n` +
      `  - 防具：「防具·名称[品质]」，如 防具·皮甲[优秀]\n` +
      `  - 道具：无前缀无品质，如 干粮 x2、治疗药水\n` +
      `- 品质等级从低到高：普通 < 优秀 < 稀有 < 史诗 < 传说。\n` +
      `- 同一名称不同品质是不同物品；玩家当前装备与背包中的物品名必须保持原样（含前缀与品质标记）。\n` +
      `- 获得战利品时按来源的稀有度分配品质：小怪掉落多为[普通]/[优秀]，精英/宝箱可得[稀有]/[史诗]，Boss/遗迹核心可得[传说]。`
    );
  }

  // —— 剧情原则 ——
  const plotRules = [
    '不要代替玩家做出决定性动作（玩家没说逃跑，就不要写"你逃走了"）；玩家自由行动都要给予合理结果。',
  ];
  if (schema.includes('hp')) {
    plotRules.push('玩家行动导致死亡（hp 将降到 0 以下）时，delta.hp 应恰好使生命归 0，并描写死亡结局，游戏结束；hp 归零后不再生成剧情。');
  }
  sections.push(`【剧情原则】\n${plotRules.map((r, i) => `${i + 5}. ${r}`).join('\n')}`);

  // —— 世界观 ——
  let worldText = `世界观：${theme.intro}`;
  if (theme.gmGuidelines) worldText += `\n叙事要点：${theme.gmGuidelines}`;
  sections.push(worldText);

  // —— 玩家状态 + 历史 ——
  sections.push(`玩家当前状态：\n${renderPlayer(player, theme)}`);
  sections.push(
    `最近剧情回顾（供你保持连贯性）：\n` +
    (history.length
      ? history.slice(-6).map((h) => `[${h.role === 'user' ? '玩家' : '旁白'}] ${h.content}`).join('\n')
      : '（无）')
  );

  return sections.join('\n\n');
}

/** 首次解析失败时使用的精简重试提示词 */
function buildRetryPrompt(player, theme) {
  const deltaExample = buildDeltaExample(theme);
  const lines = [
    `你是「${theme.name}」的文字冒险游戏主持人，请严格以 JSON 格式输出本回合结果，不要输出任何其他文字。必须使用如下格式：`,
    `{"narrative":"200~400字剧情，第二人称，承接上回合","choices":["选项1","选项2"],"delta":${deltaExample}}`,
  ];
  if (hasGear(theme)) {
    lines.push('武器命名「武器·名称[品质]」、防具命名「防具·名称[品质]」（品质：普通/优秀/稀有/史诗/传说），道具无前缀；');
  }
  lines.push('获得物品填 inventory（进入背包，装备由玩家按钮完成），你无权移除或换装任何物品。玩家状态：');
  lines.push(renderPlayer(player, theme));
  return lines.join('\n');
}

/**
 * 校验并规范化 LLM 返回的 delta（属性变化）。
 * 只保留世界观启用的数值；物品移动字段（removeInventory/weapon/armor）一律忽略。
 */
function normalizeDelta(delta, theme) {
  const schema = theme.capabilities.statSchema;
  const out = { hp: 0, gold: 0, exp: 0, inventory: [] };
  if (!delta || typeof delta !== 'object') return out;

  if (schema.includes('hp')) out.hp = Math.round(Number(delta.hp) || 0);
  if (schema.includes('gold')) out.gold = Math.round(Number(delta.gold) || 0);
  if (schema.includes('exp')) out.exp = Math.round(Number(delta.exp) || 0);

  const inv = Array.isArray(delta.inventory) ? delta.inventory : [];
  out.inventory = inv.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  return out;
}

/**
 * 应用 delta 到玩家状态，返回 { player, effects: string[] }。
 */
function applyDelta(player, delta, theme) {
  const schema = theme.capabilities.statSchema;
  const effects = [];

  if (schema.includes('hp') && delta.hp !== 0) {
    player.hp = Math.max(MIN_HP, Math.min(player.maxHp, player.hp + delta.hp));
    effects.push(delta.hp > 0 ? `生命 +${delta.hp}` : `生命 ${delta.hp}`);
  }
  if (schema.includes('gold') && delta.gold !== 0) {
    player.gold = Math.max(0, player.gold + delta.gold);
    effects.push(delta.gold > 0 ? `金币 +${delta.gold}` : `金币 ${delta.gold}`);
  }
  if (schema.includes('exp') && delta.exp !== 0) {
    player.exp += delta.exp;
    while (player.exp >= player.level * 100) {
      player.exp -= player.level * 100;
      player.level += 1;
      player.maxHp += 10;
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

/**
 * 核心动作处理：把玩家输入交给 LLM，解析并应用结果。
 */
async function processAction(game, userInput) {
  const history = game.history;
  const theme = game.theme;

  // 0. 若存在待结算的按钮动作，合并进玩家输入一并提交给 AI
  let mergedInput = userInput;
  if (game.pendingActions && game.pendingActions.length) {
    const pendingDesc = game.pendingActions.map((p) => `（动作：${p.message}）`).join('，');
    mergedInput = `${userInput}。此前你已通过快捷按钮执行：${pendingDesc}，请根据这些已发生的动作推进剧情并结算其效果（使用道具的效果由你决定，如食物回血等；已在背包中移除的消耗品不要重复移除）。`;
    clearPendingActions(game);
  }

  // 1. 追加玩家输入到历史
  history.push({ role: 'user', content: mergedInput });

  // 2. 调用 LLM（首次解析失败会自动重试；仍失败则降级为纯文本接续）
  const messages = [
    { role: 'system', content: buildSystemPrompt(game.player, history, theme) },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];
  const retryMessages = [
    { role: 'system', content: buildRetryPrompt(game.player, theme) },
    { role: 'user', content: `上一回合玩家行动：${history[history.length - 1]?.content}\n请继续推进剧情。` },
  ];

  const { action, narrative: degradedText } = await runTurn({ messages, retryMessages, maxTokens: 4096 });

  // 3. 降级接续：模型固执输出纯文本时，直接接续剧情，不打断游戏
  if (action === null) {
    const narrative = degradedText;
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
      gameOver: theme.capabilities.statSchema.includes('hp') && game.player.hp <= 0,
      degraded: true,
    };
  }

  // 4. 应用状态变化
  const delta = normalizeDelta(action.delta, theme);
  const { player, effects } = applyDelta(game.player, delta, theme);

  // 5. 追加旁白到历史，并持久化推荐选项
  const narrative = String(action.narrative || '（AI 未返回剧情）').slice(0, 2000);
  const choices = Array.isArray(action.choices) ? action.choices.slice(0, 3).map(String) : [];
  history.push({ role: 'assistant', content: narrative, choices });
  if (history.length > 40) history.splice(0, history.length - 40);

  // 6. 判断游戏结束
  const gameOver = theme.capabilities.statSchema.includes('hp') && player.hp <= 0;

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

/** 存档列表摘要（供 storage 复用） */
function summarize(game) {
  return {
    playerName: game.player?.name || '无名冒险者',
    level: game.player?.level || 1,
    mode: game.mode || 'world',
    themeName: game.theme?.name || '',
  };
}

module.exports = {
  modeId: 'world',
  modeName: '大世界模式',
  needsTheme: true,
  newGame,
  processAction,
  renderPlayer,
  buildSystemPrompt,
  summarize,
  // 物品按钮操作（与引擎共享实现）
  useItem,
  discardItem,
  cancelPendingAction,
  equipItem,
  unequipItem,
  clearPendingActions,
  removeFromInventory,
  restoreItem,
};
