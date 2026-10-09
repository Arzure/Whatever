const { chat } = require('../llm');
const { parseActionJson } = require('../engine');

/**
 * 推理杀模式：玩家是「法官」，AI 全为角色，玩家不参与只裁决。
 *
 * 核心理念与探案/狼人杀一致：【身份真相由代码持有，AI 只按身份发言】。
 * - 6 人局 = 2 狼 + 1 预言家 + 3 村民（全部 AI，无真人角色；法官不参与不死）。
 * - 夜晚无交互：狼刀 + 预言家验人由程序确定性结算，天亮给死讯（被刀不亮身份）。
 * - 白天：存活 AI 依次发言——好人说实话（预言家可公布验人）；狼人编造身份
 *   （可悍跳预言家/村民、编假验人），法官只旁观。
 * - 裁决：法官按钮二选一——①处刑某人（公开真实身份牌）②放弃处刑（直接进下一夜）。
 * - 胜负：全部狼被处刑 → 法官（好人方）胜；好人阵营全灭 → 狼胜。
 */

const MODE_ID = 'deduction';
const MODE_NAME = '推理杀';
const ROLES = { wolf: '狼人', seer: '预言家', villager: '村民' };
const AI_NAMES = ['林晚', '周舟', '苏晴', '阿澈', '孟瑶', '老陈', '何欢', '顾言', '许诺', '程野'];
const MAX_SPEECH = 500;
const MAX_HISTORY = 80;

// ==================== 工具 ====================

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function findPlayer(w, id) {
  return w.players.find((p) => p.id === id) || null;
}

function alivePlayers(w) {
  return w.players.filter((p) => p.alive);
}

function trimHistory(game) {
  if (game.history.length > MAX_HISTORY) game.history.splice(0, game.history.length - MAX_HISTORY);
}

// ==================== 身份与开局 ====================

/** 6 人局身份分配：全部 AI，1 狼 + 1 预言家 + 4 村民 */
function assignRoles() {
  const names = shuffle(AI_NAMES).slice(0, 6);
  const roles = shuffle(['wolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
  return names.map((n, i) => ({ id: `p${i + 1}`, name: n, role: roles[i], isPlayer: false, alive: true }));
}

/**
 * 结算一夜：狼刀 + 预言家验人（程序确定性判定）。
 * 首夜（round 1）狼只能刀村民——保证预言家至少活过第一轮，避免"首夜预言家暴毙、信息归零"。
 * @returns {object|null} 被狼刀死的人
 */
function settleNight(game) {
  const w = game.deduction;
  const wolf = w.players.find((p) => p.role === 'wolf' && p.alive);
  const aliveNonWolf = alivePlayers(w).filter((p) => p.role !== 'wolf');
  // 首夜刀人池：仅村民（预言家首夜安全）；后续夜为全部非狼
  const killPool = w.round === 1
    ? aliveNonWolf.filter((p) => p.role === 'villager')
    : aliveNonWolf;

  // 狼刀目标：优先刀「狼发言中怀疑的人」，否则从刀人池随机
  let target = null;
  if (wolf) {
    const sus = findPlayer(w, w.suspect[wolf.id]);
    if (sus && sus.alive && sus.role !== 'wolf') {
      // 首夜若怀疑目标是预言家则忽略（只能刀村民）
      if (w.round !== 1 || sus.role === 'villager') target = sus;
    }
  }
  if (!target) {
    target = killPool.length ? killPool[Math.floor(Math.random() * killPool.length)] : null;
  }

  let killed = null;
  if (target) {
    target.alive = false;
    killed = target;
  }

  // 预言家验人：随机验一个存活者（结果只供其发言引用）
  const seer = w.players.find((p) => p.role === 'seer' && p.alive);
  let seerTarget = null;
  let seerResult = null;
  if (seer) {
    const pool = alivePlayers(w).filter((p) => p.id !== seer.id);
    const st = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (st) {
      seerTarget = st;
      seerResult = st.role === 'wolf' ? 'wolf' : 'good';
    }
  }

  w.night = {
    killedByWolf: killed ? killed.id : null,
    seerTarget: seerTarget ? seerTarget.id : null,
    seerResult,
  };
  if (killed) {
    // 被刀死亡：不亮身份（与狼人杀对齐），role 留空
    w.deaths.push({ round: w.round, playerId: killed.id, name: killed.name, cause: 'night', role: '' });
  }
  return killed;
}

/** 胜负判定：返回 'good' | 'wolf' | null（未分胜负） */
function checkWinner(w) {
  const aliveWolves = w.players.filter((p) => p.role === 'wolf' && p.alive);
  if (!aliveWolves.length) return 'good'; // 全部狼被处刑 → 好人（法官）胜
  const aliveGood = w.players.filter((p) => p.role !== 'wolf' && p.alive);
  if (!aliveGood.length) return 'wolf'; // 好人阵营全灭 → 狼胜
  return null;
}

// ==================== 叙事（模板，MVP 不调 LLM） ====================

function buildDawnNarrative(game, killed, isFirstNight) {
  const w = game.deduction;
  const alive = alivePlayers(w);
  const names = alive.map((p) => p.name).join('、');
  const deathText = killed
    ? `昨夜，狼人在黑暗中出没——「${killed.name}」被发现倒在家中，再也没能醒来。（身份未知）`
    : '昨夜风平浪静，没有人死去。';
  const dayTag = isFirstNight ? '天亮了。' : `—— 第 ${w.round} 天 ——\n\n天亮了。`;
  return (
    `${dayTag}${deathText}\n\n现在，村里还活着的人：${names}。\n\n` +
    `（你是法官——不参与游戏，只负责裁决。请听完大家的发言后，决定是否处刑某人。）\n\n` +
    `白天的规则：每人发言一次，然后由你裁决——处刑最可疑的人（公开其身份牌），或放弃处刑直接进入下一夜。\n\n` +
    `（请开始听取发言。）`
  );
}

/** 结局复盘：全部身份揭示 */
function buildEndNarrative(w, lastExiled) {
  const reveal = w.players
    .map((p) => `  ${p.name}：${ROLES[p.role]}`)
    .join('\n');
  const wolfNames = w.players.filter((p) => p.role === 'wolf').map((p) => p.name).join('、');
  if (w.phase === 'win') {
    return (
      `全部狼人已被处刑——${wolfNames}。村庄恢复宁静，好人阵营获胜！`
    );
  }
  if (lastExiled) {
    return (
      `「${lastExiled.name}」被处刑，身份公开：【${ROLES[lastExiled.role]}】——可惜，那不是狼人。\n\n` +
      `好人阵营的力量已经耗尽，狼人「${wolfNames}」仍然潜伏在阴影中。狼人获胜。`
    );
  }
  return (
    `好人阵营已经失去了反击的力量，狼人「${wolfNames}」潜伏在村庄中。狼人获胜。`
  );
}

/** 处刑/裁决的叙事拼接 */
function buildAdjudicateNarrative(w, target, isPass) {
  if (isPass) {
    return `你权衡再三，决定【放弃处刑】——证据还不够充分，贸然出手可能误伤好人。\n\n今天没有人被放逐，直接进入下一夜。`;
  }
  const roleText = ROLES[target.role];
  const correct = target.role === 'wolf';
  return (
    `你举起法槌，指向「${target.name}」，下令处刑。\n\n` +
    `「${target.name}」被带下去，身份牌翻开——【${roleText}】！${correct ? '这正是狼人，你的判断精准无误。' : '可惜，那不是狼人……你误伤了一位好人。'}`
  );
}

// ==================== 发言引擎（LLM，串行生成） ====================

function buildSpeechPrompt(game, speaker) {
  const w = game.deduction;
  const alive = alivePlayers(w);
  const aliveList = alive.map((p) => p.name).join('、');
  const prior = w.speeches
    .filter((s) => s.round === w.round && s.playerId !== speaker.id)
    .map((s) => `${s.name}：${s.speech}`)
    .join('\n');
  const night = w.night || {};

  let roleLine;
  if (speaker.role === 'wolf') {
    const killed = findPlayer(w, night.killedByWolf);
    roleLine =
      `你的身份是【狼人】——昨夜你刀杀了${killed ? `「${killed.name}」` : '目标'}。你的任务：隐藏身份，避免自己被处刑。` +
      `你【必须伪装成一个村民】来自称（只能说自己是普通村民，不要自称预言家）。` +
      `你的发言要【冷静、克制、符合常理】：只陈述"你自己做了什么、看到了什么"这类貌似合理的内容，` +
      `可以编造一些与自己"村民身份"相符的日常信息（如"我昨夜在屋内休息，没有外出"），` +
      `但【不要做出任何无端指控】——不要凭空说"我怀疑X是狼"而没有理由，那样反而会暴露自己。` +
      `当别人怀疑你时，用平静的事实自证（如"我不可能刀人，因为我整夜都在家"），绝不歇斯底里。`;
  } else if (speaker.role === 'seer') {
    const t = findPlayer(w, night.seerTarget);
    const res = night.seerResult === 'wolf' ? '狼人' : '好人';
    roleLine =
      `你的身份是【预言家】——每夜可查验一人。昨夜你查验了「${t ? t.name : '某人'}」，结果是【${res}】。` +
      `你要【如实公布】你的身份与验人结果（不要谎报身份），这是最可靠的信息。` +
      `除此之外，只陈述客观事实，不做无端猜测。`;
  } else {
    roleLine =
      `你的身份是【村民】——你不知道任何人的身份。你只能陈述自己的行为与亲眼所见、亲耳所闻的信息` +
      `（如"我昨夜在家中休息""我听到隔壁有动静"），以及你自己被谁质疑、你如何回应。` +
      `你不掌握任何他人身份的实据，所以【不要凭空指控谁一定是狼】；你可以说明"据我所知……""我只知道我自己是村民"。`;
  }

  // 陈述事实原则（对所有角色统一约束）
  const factLine =
    `【发言风格 — 最高原则】\n` +
    `1. 只陈述事实：只说自己做了什么、看到/听到/经历到什么，以及自己知道的信息；不做无意义寒暄，不喊口号。\n` +
    `2. 理性克制：不情绪化、不歇斯底里、不无端指控他人。你可以表达"据我所知/我没有证据"这样的谨慎判断，但不要空泛地"我觉得X可疑"。\n` +
    `3. 诚实角色（村民/预言家）说真话；狼人也【理性地】编造貌似真实的日常陈述来伪装，但绝不过度表演。`;

  return [
    `你是狼人杀类游戏「推理杀」中的玩家「${speaker.name}」，正在参加一局 6 人局（1 狼人、1 预言家、4 村民）。法官正在旁观并会裁决。`,
    roleLine,
    factLine,
    `存活玩家：${aliveList}。`,
    prior ? `到目前为止的发言（按顺序）：\n${prior}` : '你是本轮第一个发言的人。',
    '现在轮到你发言。请只输出一个 JSON 对象（不要任何解释、不要代码块标记）：',
    '{"speech":"你的发言，第一人称，60~120字","suspect":"pX"}',
    '要求：',
    '- speech：用第一人称说 2~3 句话，按上述【发言风格】陈述。',
    '- suspect：你认为最可疑的人的玩家编号（如 p2、p3），必须是存活者且不能是自己；若没有实据，可填自己（表示暂无怀疑对象）。',
    '- 【重要】suspect 必须与你的发言正文一致：发言里明确质疑了谁，suspect 就填谁；发言未质疑任何人时，suspect 填自己。',
    '- 除这个 JSON 对象外，不要输出任何其他内容。',
  ].join('\n');
}

/**
 * 校验「怀疑目标」：必须存活且不是自己；无效则随机落回。
 * 填自己表示"暂无怀疑对象"（返回 voter.id，供狼刀逻辑识别为无目标）。
 */
function pickSuspect(game, voter, raw) {
  const w = game.deduction;
  const rawId = String(raw || '').trim();
  const target = findPlayer(w, rawId);
  if (rawId === voter.id) return voter.id; // 自我标记：无怀疑对象
  if (target && target.alive && target.id !== voter.id) return target.id;
  const pool = alivePlayers(w).filter((p) => p.id !== voter.id);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : '';
}

/**
 * 从发言正文中提取「有效怀疑目标」：发言里明确点名的存活者（非自己）。
 * 保证"投的人 = 发言质疑的人"，杜绝 LLM 输出割裂。
 */
function suspectFromSpeech(w, voter, speech) {
  const text = String(speech || '');
  for (const p of alivePlayers(w)) {
    if (p.id === voter.id) continue;
    if (text.includes(p.name)) return p.id;
  }
  return null;
}

/** 生成单个 AI 的发言；失败时回落模板（保证回合不断） */
async function generateSpeech(game, speaker) {
  const w = game.deduction;
  const system = buildSpeechPrompt(game, speaker);
  try {
    const text = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: '请发表你的发言。' },
      ],
      { temperature: 0.85, maxTokens: 400 }
    );
    const obj = parseActionJson(text);
    const speech = String((obj && obj.speech) || '').trim().slice(0, MAX_SPEECH);
    if (!speech) throw new Error('empty speech');
    let suspect = String((obj && obj.suspect) || '').trim();
    const named = suspectFromSpeech(w, speaker, speech);
    const target = findPlayer(w, suspect);
    if (named && (!target || target.id !== named)) suspect = named;
    return { speech, suspect };
  } catch (err) {
    console.log('[debug] 推理杀发言失败:', String(err.message).slice(0, 60));
    return {
      speech: '我还在斟酌……目前没有太确定的怀疑对象，想再多听听大家的说法。',
      suspect: '',
    };
  }
}

// ==================== 对外状态视图（防剧透） ====================

function snapshotDeduction(game) {
  const w = game.deduction;
  const over = w.phase === 'win' || w.phase === 'lose';
  return {
    phase: w.phase,
    round: w.round,
    winner: w.winner,
    players: w.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, isPlayer: false })),
    deaths: w.deaths.map((d) => ({
      round: d.round,
      name: d.name,
      cause: d.cause, // night（不亮身份） | execute（亮身份）
      role: d.cause === 'execute' ? ROLES[d.role] : '',
    })),
    // 仅游戏结束时揭示全部身份
    roles: over
      ? w.players.map((p) => ({ name: p.name, role: ROLES[p.role] }))
      : null,
    aliveCount: alivePlayers(w).length,
    canAdjudicate: w.phase === 'adjudicate',
  };
}

function snapshot(game) {
  return {
    mode: MODE_ID,
    caseTitle: `推理杀·第${game.deduction.round}天`,
    deduction: snapshotDeduction(game),
    gameOver: checkOver(game),
  };
}

/** 统一回合返回结构 */
function resultPayload(game, extra) {
  const w = game.deduction;
  return {
    narrative: extra.narrative,
    choices: extra.choices || [],
    effects: extra.effects || [],
    player: game.player,
    deduction: snapshotDeduction(game),
    pendingActions: [],
    phase: w.phase,
    gameOver: w.phase === 'win' || w.phase === 'lose',
    degraded: !!extra.degraded,
  };
}

// ==================== 模式契约 ====================

/** 开局：分配身份 + 第一夜结算，返回"天亮了"叙事（无需 LLM） */
function newGame(playerName, opts = {}) {
  const w = {
    phase: 'day', // day（听发言）→ adjudicate（法官裁决）→ win/lose
    round: 1,
    players: assignRoles(),
    speeches: [], // { round, playerId, name, speech }
    suspect: {}, // playerId -> 其当前怀疑目标 id
    deaths: [], // { round, playerId, name, cause, role }
    night: null, // { killedByWolf, seerTarget, seerResult }
    winner: null,
  };
  const game = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: MODE_ID,
    theme: null,
    player: { name: playerName || '法官', hp: 100, maxHp: 100, inventory: [], slots: {} },
    deduction: w,
    history: [],
    pendingActions: [],
  };
  const killed = settleNight(game);
  game.history.push({ role: 'assistant', content: buildDawnNarrative(game, killed, true), choices: [] });
  return game;
}

/**
 * 白天：AI 依次发言（法官不发言），发言结束后进入裁决阶段。
 * 注意：一次调用会串行生成所有存活 AI 的发言（每个一次 LLM），耗时数秒~二十秒。
 */
async function processAction(game, userInput, opts = {}) {
  const w = game.deduction;
  if (w.phase === 'win' || w.phase === 'lose') throw new Error('游戏已经结束');
  if (w.phase !== 'day') throw new Error('当前不是发言阶段');

  // AI 依次发言（顺序 = players 数组顺序，跳过死者）
  const aiSpeeches = [];
  for (const p of w.players) {
    if (!p.alive) continue;
    const { speech, suspect } = await generateSpeech(game, p);
    w.speeches.push({ round: w.round, playerId: p.id, name: p.name, speech });
    w.suspect[p.id] = pickSuspect(game, p, suspect);
    aiSpeeches.push(`「${p.name}」：${speech}`);
  }

  w.phase = 'adjudicate';
  const narrative = aiSpeeches.length
    ? `大家的发言如下：\n\n${aiSpeeches.join('\n\n')}\n\n—— 现在由你裁决：处刑某人（公开其身份牌），或放弃处刑直接进入下一夜。`
    : '所有人都沉默了。现在由你裁决。';
  game.history.push({ role: 'assistant', content: narrative, choices: [] });
  game.updatedAt = Date.now();
  trimHistory(game);
  return resultPayload(game, { narrative, choices: [] });
}

/**
 * 法官裁决：处刑 targetId 或放弃（pass）。
 * 处刑 → 公开真实身份牌 → 校验是否狼 → 判胜负；放弃 → 无放逐 → 进下一夜。
 */
async function adjudicate(game, targetId) {
  const w = game.deduction;
  if (w.phase === 'win' || w.phase === 'lose') return { ok: false, message: '游戏已经结束' };
  if (w.phase !== 'adjudicate') return { ok: false, message: w.phase === 'day' ? '白天发言还没结束' : '当前不能裁决' };

  const isPass = !targetId;
  let target = null;
  if (!isPass) {
    target = findPlayer(w, String(targetId || '').trim());
    if (!target || !target.alive) return { ok: false, message: '无效的处刑目标' };
    target.alive = false;
    w.deaths.push({ round: w.round, playerId: target.id, name: target.name, cause: 'execute', role: target.role });
  }

  let narrative = buildAdjudicateNarrative(w, target, isPass);

  // 胜负判定
  const winner = checkWinner(w);
  if (winner) {
    w.phase = winner === 'good' ? 'win' : 'lose';
    w.winner = winner;
    narrative += `\n\n${buildEndNarrative(w, target)}\n\n—— 游戏结束 ——\n\n【身份复盘】\n${w.players
      .map((p) => `  ${p.name}：${ROLES[p.role]}`)
      .join('\n')}`;
    game.history.push({ role: 'assistant', content: narrative, choices: [] });
    game.updatedAt = Date.now();
    trimHistory(game);
    return { ok: true, message: `游戏结束（${winner === 'good' ? '好人获胜' : '狼人获胜'}）`, payload: resultPayload(game, { narrative, choices: [] }) };
  }

  // 未分胜负 → 进入下一夜并天亮
  w.round += 1;
  const killed = settleNight(game);
  // 夜晚结算后再次判定胜负
  const winnerAfterNight = checkWinner(w);
  if (winnerAfterNight) {
    w.phase = winnerAfterNight === 'good' ? 'win' : 'lose';
    w.winner = winnerAfterNight;
    narrative += `\n\n${buildEndNarrative(w, target)}\n\n—— 游戏结束 ——\n\n【身份复盘】\n${w.players
      .map((p) => `  ${p.name}：${ROLES[p.role]}`)
      .join('\n')}`;
    game.history.push({ role: 'assistant', content: narrative, choices: [] });
    game.updatedAt = Date.now();
    trimHistory(game);
    return { ok: true, message: `游戏结束（${winnerAfterNight === 'good' ? '好人获胜' : '狼人获胜'}）`, payload: resultPayload(game, { narrative, choices: [] }) };
  }
  w.phase = 'day';
  narrative += `\n\n${buildDawnNarrative(game, killed, false)}`;
  game.history.push({ role: 'assistant', content: narrative, choices: [] });
  game.updatedAt = Date.now();
  trimHistory(game);
  return { ok: true, message: isPass ? '已放弃处刑' : '裁决已生效', payload: resultPayload(game, { narrative, choices: [] }) };
}

// ==================== 存档摘要 / 结束判定 / 物品（无物品） ====================

function summarize(game) {
  return {
    playerName: game.player.name,
    level: 1,
    mode: MODE_ID,
    themeName: '',
    caseTitle: `推理杀·第${game.deduction.round}天`,
  };
}

function checkOver(game) {
  const w = game.deduction;
  if (w.phase === 'win') return { over: true, reason: 'win', message: '全部狼人被处刑，好人获胜' };
  if (w.phase === 'lose') return { over: true, reason: 'lose', message: '好人阵营全灭，狼人获胜' };
  return { over: false, reason: '', message: '' };
}

/** 推理杀没有物品操作，一律拒绝 */
function noItems() {
  return { ok: false, message: '推理杀没有物品系统' };
}

function renderPlayer(game) {
  const w = game.deduction;
  return [
    `- 姓名：${game.player.name}（法官）`,
    `- 阶段：${w.phase}（第 ${w.round} 天）`,
    `- 存活人数：${alivePlayers(w).length}`,
    `- 已处刑：${w.deaths.filter((d) => d.cause === 'execute').length} 人`,
  ].join('\n');
}

module.exports = {
  modeId: MODE_ID,
  modeName: MODE_NAME,
  needsTheme: false,
  needsGenre: false,
  needsLLM: false, // 开局不需要 LLM（发言时才需要，由路由统一检查）
  newGame,
  processAction,
  adjudicate,
  renderPlayer,
  buildSystemPrompt: () => '推理杀模式：见 generateSpeech 的逐人提示词。',
  checkOver,
  snapshot,
  summarize,
  useItem: noItems,
  discardItem: noItems,
  equipItem: noItems,
  unequipItem: noItems,
  cancelPendingAction: noItems,
  clearPendingActions: () => {},
  // 供单元测试与工具层复用
  __test: { pickSuspect },
};
