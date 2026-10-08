const { chat } = require('../llm');
const { parseActionJson } = require('../engine');

/**
 * 狼人杀模式：单人对战 AI 的 5 人局推理游戏（MVP）。
 *
 * 与探案模式同构的核心理念：【身份真相由代码持有，AI 只按身份发言与投票】。
 * - 玩家固定为「村民」（好人阵营），任务是找出狼人并投票放逐。
 * - 5 人局 = 玩家 + 1 狼人 + 1 预言家 + 2 村民。
 * - 夜晚无交互：狼刀 / 预言家验人由程序确定性结算，天亮直接给死讯。
 * - 白天：玩家先发言，AI 依次发言（每人生成一次，可基于前序发言反应）。
 * - 投票：玩家按钮投 1 票 + AI 按各自「怀疑目标」投票 → 最高票放逐、公开身份。
 * - 胜负：狼人被放逐 → 好人胜；玩家死亡或好人阵营仅剩玩家 → 狼人胜。
 */

const MODE_ID = 'wolf';
const MODE_NAME = '狼人杀';
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

/** 5 人局身份分配：玩家固定村民，其余 4 人随机分配 1 狼 + 1 预言家 + 2 村民 */
function assignRoles(playerName) {
  const names = shuffle(AI_NAMES).slice(0, 4);
  const roles = shuffle(['wolf', 'seer', 'villager', 'villager']);
  return [
    { id: 'p1', name: playerName || '村民甲', role: 'villager', isPlayer: true, alive: true },
    ...names.map((n, i) => ({ id: `p${i + 2}`, name: n, role: roles[i], isPlayer: false, alive: true })),
  ];
}

/**
 * 结算一夜：狼刀 + 预言家验人（均由程序确定性判定）。
 * @param {{ protectPlayer?: boolean }} opts 首次入夜保护玩家（不刀玩家，避免新手第一夜暴毙）
 * @returns {object|null} 被狼刀死的人
 */
function settleNight(game, opts = {}) {
  const w = game.wolf;
  const protectPlayer = !!opts.protectPlayer;
  const wolf = w.players.find((p) => p.role === 'wolf' && p.alive);
  const aliveNonWolf = alivePlayers(w).filter((p) => p.role !== 'wolf');

  // 狼刀目标：优先狼人的「怀疑目标」（第二夜起可刀玩家）；否则随机（首夜排除玩家）
  let target = null;
  if (wolf) {
    const sus = w.suspect[wolf.id];
    const susTarget = findPlayer(w, sus);
    if (susTarget && susTarget.alive && susTarget.role !== 'wolf') target = susTarget;
  }
  if (!target) {
    const pool = protectPlayer ? aliveNonWolf.filter((p) => !p.isPlayer) : aliveNonWolf;
    target = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  let killed = null;
  if (target) {
    target.alive = false;
    killed = target;
  }

  // 预言家验人：优先验自己的「怀疑目标」，否则随机；结果只记录，供预言家发言引用
  const seer = w.players.find((p) => p.role === 'seer' && p.alive);
  let seerTarget = null;
  let seerResult = null;
  if (seer) {
    const sus = w.suspect[seer.id];
    let st = findPlayer(w, sus);
    if (!st || !st.alive || st.id === seer.id) {
      const pool = alivePlayers(w).filter((p) => p.id !== seer.id);
      st = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
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
    // 夜晚被刀：身份不公开（经典规则），role 留空
    w.deaths.push({ round: w.round, playerId: killed.id, name: killed.name, cause: 'night', role: '' });
  }
  return killed;
}

/** 胜负判定：返回 'good' | 'wolf' | null（未分胜负） */
function checkWinner(w) {
  const wolf = w.players.find((p) => p.role === 'wolf');
  if (!wolf.alive) return 'good'; // 狼人被放逐 → 好人胜
  const player = w.players.find((p) => p.isPlayer);
  if (!player.alive) return 'wolf'; // 玩家死亡 → 狼人胜
  const aliveGood = alivePlayers(w).filter((p) => p.role !== 'wolf');
  if (aliveGood.length === 1) return 'wolf'; // 好人只剩玩家（狼 vs 玩家，狼人胜）
  return null;
}

// ==================== 叙事（模板，MVP 不调 LLM） ====================

function buildDawnNarrative(game, killed, isFirstNight) {
  const w = game.wolf;
  const alive = alivePlayers(w);
  const names = alive.map((p) => p.name).join('、');
  const deathText = killed
    ? `昨夜，狼人在黑暗中出没——「${killed.name}」被发现倒在家中，再也没能醒来。`
    : '昨夜风平浪静，没有人死去。';
  const roleText = '（你的身份：村民——好人阵营。找出狼人，投票放逐他。）';
  const dayTag = isFirstNight ? '天亮了。' : `—— 第 ${w.round} 天 ——\n\n天亮了。`;
  return (
    `${dayTag}${deathText}\n\n现在，村里还活着的人：${names}。${roleText}\n\n` +
    `白天的规则：每人发言一次，然后投票放逐最可疑的人。被放逐者的身份会公开；被狼人杀害的人身份不会公开。\n\n` +
    `（你是第一个发言的人，请开始。）`
  );
}

/** 投票明细（谁投了谁） */
function buildVoteNarrative(w, ballots) {
  const lines = [];
  for (const p of alivePlayers(w)) {
    const target = findPlayer(w, ballots[p.id]);
    lines.push(`${p.isPlayer ? '你' : p.name}：投给了${target ? `「${target.name}」` : '（未投）'}`);
  }
  return lines.join('\n');
}

/** 结局复盘：全部身份揭示 */
function buildEndNarrative(w, exiled) {
  const wolf = w.players.find((p) => p.role === 'wolf');
  const reveal = w.players
    .map((p) => `  ${p.name}${p.isPlayer ? '（你）' : ''}：${ROLES[p.role]}`)
    .join('\n');
  if (w.phase === 'win') {
    return (
      `「${wolf.name}」被放逐，身份公开：【狼人】！\n\n狼人已除，村庄恢复了宁静。好人阵营获胜！`
    );
  }
  if (exiled) {
    return (
      `「${exiled.name}」被放逐，身份公开：【${ROLES[exiled.role]}】——可惜，那不是狼人。\n\n` +
      `好人阵营的力量已经耗尽，狼人「${wolf.name}」仍然潜伏在阴影中。狼人获胜。`
    );
  }
  return (
    `好人阵营已经失去了反击的力量，狼人「${wolf.name}」潜伏在村庄中。狼人获胜。`
  );
}

// ==================== 发言引擎（LLM，串行生成） ====================

function buildSpeechPrompt(game, speaker) {
  const w = game.wolf;
  const alive = alivePlayers(w);
  const aliveList = alive.map((p) => p.name).join('、');
  const prior = w.speeches
    .filter((s) => s.round === w.round && s.playerId !== speaker.id)
    .map((s) => `${s.name}：${s.speech}`)
    .join('\n');
  const night = w.night || {};
  // 预言家已公开公布过的验人结果（本局全部历史，供好人参考带票）
  const seerClaims = [];
  for (const s of w.speeches) {
    const sp = findPlayer(w, s.playerId);
    if (!sp || sp.role !== 'seer') continue;
    const m = String(s.speech || '').match(/查验了(.{1,6}?)[，,。]/);
    if (m) seerClaims.push(m[1].trim());
  }

  let roleLine;
  if (speaker.role === 'wolf') {
    const killed = findPlayer(w, night.killedByWolf);
    roleLine = `你的身份是【狼人】——昨夜你刀杀了${killed ? `「${killed.name}」` : '目标'}。你的任务：隐藏自己活到最后。你必须伪装成普通好人，说话要自然；若被怀疑要冷静辩解并把怀疑转移给其他人；你可以带头质疑某人（带票），但不要表现得过于急切。`;
  } else if (speaker.role === 'seer') {
    const t = findPlayer(w, night.seerTarget);
    const res = night.seerResult === 'wolf' ? '狼人' : '好人';
    roleLine = `你的身份是【预言家】——每夜可查验一人。昨夜你查验了「${t ? t.name : '某人'}」，结果是【${res}】。你可以选择公布这个结果（能带领好人，但也可能引来狼人夜里杀你），也可以先隐藏暗中观察。请基于这个【真实信息】发言，不要说谎。`;
  } else {
    roleLine = '你的身份是【村民】——你不知道任何人的身份，只能从发言中寻找矛盾与可疑之处，凭推理指认狼人。';
  }

  // 好人方：若预言家公开查验过某人，好人应优先信服并与之协作，而非被狼人带节奏
  let trustLine = '';
  if (speaker.role !== 'wolf' && seerClaims.length) {
    trustLine = `已知预言家公开查验过：${seerClaims.join('、')}。预言家的验人信息是好人方最可靠的情报，若你确认了某个被查验为「好人」的人，不要随意怀疑他；你的投票更应与预言家的判断一致，而不是跟随狼人的节奏。`;
  }

  return [
    `你是狼人杀游戏中的玩家「${speaker.name}」，正在参加一局 5 人狼人杀（1 狼人、1 预言家、3 村民）。`,
    roleLine,
    trustLine,
    `存活玩家：${aliveList}。`,
    prior ? `到目前为止的发言（按顺序）：\n${prior}` : '你是本轮第一个发言的人。',
    '现在轮到你白天发言。请只输出一个 JSON 对象（不要任何解释、不要代码块标记）：',
    '{"speech":"你的白天发言，第一人称，80~150字，观点明确","suspect":"pX"}',
    '要求：',
    '- speech：用第一人称说 2~4 句话，发表对局势的判断、对某人的怀疑或辩护；预言家可公布/隐瞒验人结果。',
    '- suspect：你最怀疑的人的玩家编号（如 p2、p3），必须是存活者且不能是自己。',
    '- 【重要】suspect 必须与你的发言正文一致：发言里明确质疑了谁，suspect 就填谁。绝不能"发言怀疑甲、却填乙"。',
    '- 狼人应把嫌疑引向好人；好人要基于发言矛盾与逻辑推理，并尊重预言家的验人情报。',
    '- 除这个 JSON 对象外，不要输出任何其他内容。',
  ].join('\n');
}

/** 校验「怀疑目标/投票目标」：必须存活且不是自己；无效则随机落回 */
function pickSuspect(game, voter, raw) {
  const w = game.wolf;
  const target = findPlayer(w, String(raw || '').trim());
  if (target && target.alive && target.id !== voter.id) return target.id;
  const pool = alivePlayers(w).filter((p) => p.id !== voter.id);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : '';
}

/**
 * 从发言正文中提取「有效怀疑目标」：发言里明确点名的存活者（非自己）。
 * 这是程序级兜底：即使 LLM 的 suspect 与发言割裂（如"发言怀疑甲却填乙"），
 * 也能从正文恢复一致性，杜绝"说得好却乱投"。
 * @returns {string|null} 正文中点名的第一个存活玩家 id
 */
function suspectFromSpeech(w, voter, speech) {
  const text = String(speech || '');
  for (const p of alivePlayers(w)) {
    if (p.id === voter.id) continue;
    if (text.includes(p.name)) return p.id;
  }
  return null;
}

/** 生成单个 AI 的白天发言；失败时回落模板（保证回合不断） */
async function generateSpeech(game, speaker) {
  const w = game.wolf;
  const system = buildSpeechPrompt(game, speaker);
  try {
    const text = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: '请发表你的白天发言。' },
      ],
      { temperature: 0.85, maxTokens: 400 }
    );
    const obj = parseActionJson(text);
    const speech = String((obj && obj.speech) || '').trim().slice(0, MAX_SPEECH);
    if (!speech) throw new Error('empty speech');
    // 一致性兜底：suspect 优先取 LLM 输出，但若与发言正文割裂（正文没点名他），
    // 则从正文提取实际点名的存活者，保证"投的人 = 发言质疑的人"。
    let suspect = String((obj && obj.suspect) || '').trim();
    const named = suspectFromSpeech(w, speaker, speech);
    const target = findPlayer(w, suspect);
    if (named && (!target || target.id !== named)) {
      suspect = named;
    }
    return { speech, suspect };
  } catch (err) {
    console.log('[debug] 狼人杀发言失败:', String(err.message).slice(0, 60));
    return {
      speech: '我还在斟酌……目前没有太确定的怀疑对象，想再多听听大家的说法。',
      suspect: '',
    };
  }
}

// ==================== 对外状态视图（防剧透） ====================

function snapshotWolf(game) {
  const w = game.wolf;
  const over = w.phase === 'win' || w.phase === 'lose';
  const player = w.players.find((p) => p.isPlayer);
  return {
    phase: w.phase,
    round: w.round,
    winner: w.winner,
    playerRole: ROLES[player.role], // 玩家自己的身份对玩家公开
    players: w.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, isPlayer: p.isPlayer })),
    deaths: w.deaths.map((d) => ({
      round: d.round,
      name: d.name,
      cause: d.cause, // night（不亮身份） | vote（亮身份）
      role: d.cause === 'vote' ? ROLES[d.role] : '',
    })),
    // 仅游戏结束时揭示全部身份
    roles: over
      ? w.players.map((p) => ({ name: p.name, role: ROLES[p.role], isPlayer: p.isPlayer }))
      : null,
    aliveCount: alivePlayers(w).length,
    canSpeak: w.phase === 'day' && !!player.alive,
    canVote: w.phase === 'vote' && !!player.alive,
  };
}

function snapshot(game) {
  return {
    mode: MODE_ID,
    caseTitle: `狼人杀·第${game.wolf.round}天`,
    wolf: snapshotWolf(game),
    gameOver: checkOver(game),
  };
}

/** 统一回合返回结构 */
function resultPayload(game, extra) {
  const w = game.wolf;
  return {
    narrative: extra.narrative,
    choices: extra.choices || [],
    effects: extra.effects || [],
    player: game.player,
    wolf: snapshotWolf(game),
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
    phase: 'day', // day（玩家发言）→ vote（玩家投票）→ win/lose
    round: 1,
    players: assignRoles(playerName),
    speeches: [], // { round, playerId, name, speech }
    suspect: {}, // playerId -> 其当前怀疑目标 id（供投票使用）
    deaths: [], // { round, playerId, name, cause, role }
    night: null, // 最近一夜：{ killedByWolf, seerTarget, seerResult }
    winner: null,
  };
  const game = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: MODE_ID,
    theme: null,
    player: { name: playerName || '村民甲', hp: 100, maxHp: 100, inventory: [], slots: {} },
    wolf: w,
    history: [],
    pendingActions: [],
  };
  // 第一夜：保护玩家（不刀玩家），预言家验玩家
  const killed = settleNight(game, { protectPlayer: true });
  game.history.push({ role: 'assistant', content: buildDawnNarrative(game, killed, true), choices: [] });
  return game;
}

/**
 * 白天发言：玩家发言 → AI 依次发言 → 进入投票阶段。
 * 注意：一次调用会串行生成所有存活 AI 的发言（每个一次 LLM），耗时数秒~十几秒。
 */
async function processAction(game, userInput, opts = {}) {
  const w = game.wolf;
  if (w.phase === 'win' || w.phase === 'lose') throw new Error('游戏已经结束');
  if (w.phase !== 'day') throw new Error('当前不是发言阶段');
  const player = w.players.find((p) => p.isPlayer);
  if (!player.alive) throw new Error('你已经出局，无法发言');

  const text = String(userInput || '').trim().slice(0, MAX_SPEECH);
  if (!text) throw new Error('发言不能为空');
  if (w.speeches.some((s) => s.round === w.round && s.playerId === player.id)) {
    throw new Error('你今天已经发过言了，请等待投票');
  }

  // 玩家发言
  w.speeches.push({ round: w.round, playerId: player.id, name: player.name, speech: text });
  game.history.push({ role: 'user', content: text });

  // AI 依次发言（顺序 = players 数组顺序，跳过玩家与死者）
  const aiSpeeches = [];
  for (const p of w.players) {
    if (p.isPlayer || !p.alive) continue;
    const { speech, suspect } = await generateSpeech(game, p);
    w.speeches.push({ round: w.round, playerId: p.id, name: p.name, speech });
    w.suspect[p.id] = pickSuspect(game, p, suspect);
    aiSpeeches.push(`「${p.name}」：${speech}`);
  }

  w.phase = 'vote';
  const narrative = aiSpeeches.length
    ? `大家的发言如下：\n\n${aiSpeeches.join('\n\n')}\n\n—— 现在进入投票环节：请选择你最怀疑的人。`
    : '所有人都沉默了。现在进入投票环节。';
  game.history.push({ role: 'assistant', content: narrative, choices: [] });
  game.updatedAt = Date.now();
  trimHistory(game);
  return resultPayload(game, { narrative, choices: [] });
}

/**
 * 收集预言家公开指认的狼人 id。
 * 核心：用【代码级真相】兜底措辞差异——预言家的验人结果就在 w.night 里，
 * 只要预言家发言中点名了「真相中确实是狼」的存活玩家，就视为公开指认
 * （提示词强制预言家基于真实信息发言，他点名的狼就是他的验人结论）。
 * 这解决"预言家只说'怀疑X'没说'X是狼人'，好人无法改票"的信息脱节。
 * @returns {string|null} 被预言家公开指认的狼人 id
 */
function seerAccusedWolf(w) {
  for (const s of w.speeches) {
    const sp = findPlayer(w, s.playerId);
    if (!sp || sp.role !== 'seer') continue;
    const speech = String(s.speech || '');
    // 预言家点名了某个存活玩家，且该玩家在真相中确实是狼 → 公开指认
    for (const p of alivePlayers(w)) {
      if (p.id === sp.id || p.role !== 'wolf') continue;
      if (speech.includes(p.name)) return p.id;
    }
  }
  return null;
}

/**
 * 投票放逐（玩家按钮 + AI 按各自怀疑目标投票）。
 * 最高票唯一者被放逐并公开身份；平票则无人放逐。
 * 之后判定胜负：结束则收局复盘；未结束则进入下一夜并天亮。
 * @param {string} targetId 玩家投票目标 id
 */
async function vote(game, targetId) {
  const w = game.wolf;
  if (w.phase === 'win' || w.phase === 'lose') return { ok: false, message: '游戏已经结束' };
  if (w.phase !== 'vote') return { ok: false, message: w.phase === 'day' ? '白天发言还没结束' : '当前不能投票' };
  const player = w.players.find((p) => p.isPlayer);
  if (!player.alive) return { ok: false, message: '你已经出局，无法投票' };

  const playerTarget = findPlayer(w, String(targetId || '').trim());
  if (!playerTarget || !playerTarget.alive || playerTarget.id === player.id) {
    return { ok: false, message: '无效的投票目标' };
  }

  // 预言家公开指认的狼人：好人 AI 改票跟随（预言家情报优先于个人怀疑）
  const accusedWolf = seerAccusedWolf(w);

  // 收集票数：玩家 1 票 + 每个存活 AI 1 票（用其发言时的怀疑目标）
  const ballots = {}; // voterId -> targetId
  const tally = (voterId, tid) => {
    if (tid) ballots[voterId] = tid;
  };
  tally(player.id, playerTarget.id);
  for (const p of w.players) {
    if (p.isPlayer || !p.alive) continue;
    // 好人 AI：预言家已公开指认狼人时，改投该狼人（除非自己就是被指认的狼人）
    let tid = w.suspect[p.id];
    if (p.role !== 'wolf' && accusedWolf && accusedWolf !== p.id) {
      tid = accusedWolf;
    }
    tally(p.id, pickSuspect(game, p, tid));
  }

  // 计票：唯一最高票者被放逐；平票无人放逐
  const counts = {};
  for (const tid of Object.values(ballots)) counts[tid] = (counts[tid] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  let exiled = null;
  if (sorted.length && (!sorted[1] || sorted[0][1] > sorted[1][1])) {
    exiled = findPlayer(w, sorted[0][0]);
  }

  let narrative = `—— 投票结果 ——\n${buildVoteNarrative(w, ballots)}\n\n`;
  if (exiled) {
    exiled.alive = false;
    w.deaths.push({ round: w.round, playerId: exiled.id, name: exiled.name, cause: 'vote', role: exiled.role });
    narrative += `最高票：「${exiled.name}」被大家投出，身份公开：【${ROLES[exiled.role]}】！`;
  } else {
    narrative += '最高票出现平局——按照规矩，本轮无人被放逐。';
  }

  // 胜负判定
  const winner = checkWinner(w);
  if (winner) {
    w.phase = winner === 'good' ? 'win' : 'lose';
    w.winner = winner;
    narrative += `\n\n${buildEndNarrative(w, exiled)}\n\n—— 游戏结束 ——\n\n【身份复盘】\n${w.players
      .map((p) => `  ${p.name}${p.isPlayer ? '（你）' : ''}：${ROLES[p.role]}`)
      .join('\n')}`;
    game.history.push({ role: 'assistant', content: narrative, choices: [] });
    game.updatedAt = Date.now();
    trimHistory(game);
    return { ok: true, message: `游戏结束（${winner === 'good' ? '好人获胜' : '狼人获胜'}）`, payload: resultPayload(game, { narrative, choices: [] }) };
  }

  // 未分胜负 → 进入下一夜并天亮
  w.round += 1;
  const killed = settleNight(game, {});
  // 夜晚结算后再次判定胜负（狼可能刀死最后一名神职/村民，使狼人达成胜利条件）
  const winnerAfterNight = checkWinner(w);
  if (winnerAfterNight) {
    w.phase = winnerAfterNight === 'good' ? 'win' : 'lose';
    w.winner = winnerAfterNight;
    narrative += `\n\n${buildEndNarrative(w, exiled)}\n\n—— 游戏结束 ——\n\n【身份复盘】\n${w.players
      .map((p) => `  ${p.name}${p.isPlayer ? '（你）' : ''}：${ROLES[p.role]}`)
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
  return { ok: true, message: '投票已结算', payload: resultPayload(game, { narrative, choices: [] }) };
}

// ==================== 存档摘要 / 结束判定 / 物品（狼人杀无物品） ====================

function summarize(game) {
  return {
    playerName: game.player.name,
    level: 1,
    mode: MODE_ID,
    themeName: '',
    caseTitle: `狼人杀·第${game.wolf.round}天`,
  };
}

function checkOver(game) {
  const w = game.wolf;
  if (w.phase === 'win') return { over: true, reason: 'win', message: '狼人已被放逐，好人获胜' };
  if (w.phase === 'lose') return { over: true, reason: 'lose', message: '狼人获胜，游戏结束' };
  return { over: false, reason: '', message: '' };
}

/** 狼人杀没有物品操作，一律拒绝 */
function noItems() {
  return { ok: false, message: '狼人杀没有物品系统' };
}

function renderPlayer(game) {
  const w = game.wolf;
  const player = w.players.find((p) => p.isPlayer);
  return [
    `- 姓名：${game.player.name}`,
    `- 身份：${ROLES[player.role]}（好人阵营）`,
    `- 阶段：${w.phase}（第 ${w.round} 天）`,
    `- 存活人数：${alivePlayers(w).length}`,
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
  vote,
  renderPlayer,
  buildSystemPrompt: () => '狼人杀模式：见 generateSpeech 的逐人提示词。',
  checkOver,
  snapshot,
  summarize,
  useItem: noItems,
  discardItem: noItems,
  equipItem: noItems,
  unequipItem: noItems,
  cancelPendingAction: noItems,
  // 供单元测试与工具层复用
  __test: { suspectFromSpeech, seerAccusedWolf },
  clearPendingActions: () => {},
};
