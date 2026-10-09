const { chat } = require('../llm');
const { parseActionJson } = require('../engine');

/**
 * 推理杀模式（7 人局）：玩家是「法官」，AI 全为角色，玩家不参与只裁决。
 *
 * 核心理念与其他模式一致：【真相/身份/技能结果由代码持有，AI 只按私有知识组织发言】。
 * - 每局 7 人：好人 4（从文员/侦探/村民/法医/守卫选 4，不重复）
 *           中立 1（赌徒/小偷）
 *           坏人 2（必含 1 狼，另一为帮凶/酒鬼）
 * - 夜晚无玩家交互：多阶段管线由程序确定性结算（迷醉/遗忘/守卫/狼刀/赌徒/复制/变身）。
 * - 首轮强制身份声明：好人程序注入真身份、坏人程序注入伪装身份、中立随机真/假 → 冲突即推理素材。
 * - 白天：存活 AI 依次发言，法官只旁观，裁决处刑/放弃。
 * - 胜负：场上不存在存活狼（含变身新狼）→ 好人胜；所有好人死亡 → 坏人胜。中立无独立胜利。
 */

const MODE_ID = 'deduction';
const MODE_NAME = '推理杀';
const AI_NAMES = ['林晚', '周舟', '苏晴', '阿澈', '孟瑶', '老陈', '何欢', '顾言', '许诺', '程野'];
const MAX_SPEECH = 240;
const MAX_HISTORY = 80;
const GAME_SIZE = 7;

const ROLES = {
  // 好人
  clerk: '文员',
  detective: '侦探',
  villager: '村民',
  forensics: '法医',
  guard: '守卫',
  // 中立
  gambler: '赌徒',
  thief: '小偷',
  // 坏人
  wolf: '狼人',
  accomplice: '帮凶',
  drunkard: '酒鬼',
};

const GOOD_ROLES = ['clerk', 'detective', 'villager', 'forensics', 'guard'];
const NEUTRAL_ROLES = ['gambler', 'thief'];
const EVIL_ROLES = ['wolf', 'accomplice', 'drunkard'];
const CAMP = {
  good: '好人',
  neutral: '中立',
  evil: '坏人',
};
const ROLES_NAMES = { // 中文名 ——（对应英文 key）
  '文员': 'clerk', '侦探': 'detective', '村民': 'villager', '法医': 'forensics', '守卫': 'guard',
  '赌徒': 'gambler', '小偷': 'thief', '狼人': 'wolf', '帮凶': 'accomplice', '酒鬼': 'drunkard',
};
const campOf = (role) => (GOOD_ROLES.includes(role) ? 'good' : NEUTRAL_ROLES.includes(role) ? 'neutral' : 'evil');

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

/**
 * 7 人局身份分配：
 * - 好人：从 5 种中不重复选 4
 * - 中立：赌徒/小偷 二选一
 * - 坏人：狼人 + （帮凶/酒鬼 二选一）
 */
function assignRoles() {
  const names = shuffle(AI_NAMES).slice(0, GAME_SIZE);
  const goods = shuffle(GOOD_ROLES).slice(0, 4);
  const neutral = [shuffle(NEUTRAL_ROLES)[0]];
  // 坏人：必含 1 狼，另一为帮凶/酒鬼
  const evil = ['wolf', shuffle(['accomplice', 'drunkard'])[0]];
  const roles = shuffle([...goods, ...neutral, ...evil]);
  const players = names.map((n, i) => ({
    id: `p${i + 1}`,
    name: n,
    role: roles[i],
    isPlayer: false,
    alive: true,
    cover: null, // 公开声称的身份（好人=真；坏人=程序注入的伪装；中立=随机真/假）
  }));
  assignCovers(players);
  return players;
}

/** 为坏人/中立分配「伪装身份」，程序注入保证首轮声明冲突有效 */
function assignCovers(players) {
  // 候选人池：本局实际出现的非坏角色（好人+中立），排除文员
  // （文员必须公布角色名单，坏人跳文员给不出真名单会秒暴露）
  const pool = [...new Set(players.filter((p) => !EVIL_ROLES.includes(p.role) && p.role !== 'clerk').map((p) => p.role))];
  // 若本局没有文员，坏人可以跳文员（此时不需要公布名单，不会暴露）
  if (!players.some((p) => p.role === 'clerk')) {
    pool.push('clerk');
  }
  if (!pool.length) return;
  const evildoers = players.filter((p) => EVIL_ROLES.includes(p.role));
  const chosen = shuffle(pool);
  // 两位坏人拿两个互不相同的伪装身份（防撞 → 同一身份冲突必有一假）
  evildoers.forEach((p, i) => {
    p.cover = chosen[i % chosen.length];
  });
  // 中立随机：真身份 / 假身份
  players.filter((p) => NEUTRAL_ROLES.includes(p.role)).forEach((p) => {
    if (Math.random() < 0.5) {
      p.cover = null; // 说真话
    } else {
      const rest = pool.filter((r) => r !== p.role);
      p.cover = rest.length ? rest[Math.floor(Math.random() * rest.length)] : null;
    }
  });
}

/** 本局出现的角色名册（去重，按 ROLES 名） */
function rolePoolOf(players) {
  return [...new Set(players.map((p) => p.role))].map((r) => ROLES[r]);
}

// ==================== 夜晚管线 ====================

/**
 * 变身判定（在每次夜晚开始时调用）：
 * 若场上不存在存活狼，且帮凶/酒鬼存活 → 转变为新狼。
 * 允许链式变身：狼被处刑→帮凶变狼→帮凶被处刑→酒鬼再变狼（否则无狼即死局）。
 * 变身后当夜即可行动（对应"白天处刑狼，当晚新狼可刀"）。
 */
function processTurn(w) {
  const wolf = w.players.find((p) => p.role === 'wolf' && p.alive);
  if (wolf) return;
  const cand = w.players.filter((p) => (p.role === 'accomplice' || p.role === 'drunkard') && p.alive);
  const next = cand.find((p) => p.role === 'accomplice') || cand[0];
  if (!next) return;
  next.role = 'wolf';
  w.turned = { playerId: next.id, round: w.round };
  // 变身者沿用自己开局分配的原伪装身份（cover），与先前发言完全一致，不重新分配
  // （帮凶/酒鬼在 assignCovers 阶段必已获得 cover，此处无需也不应重发）
}

/**
 * 锁定本夜行动（阶段 1）。只记录"谁对谁做什么"，不结算效果。
 * @returns {{
 *   wolf: {target}, guard: {target}, detective: {target}, accomplice: {target},
 *   thief: {target}, gambler: {target, claim}, forensics: {active, deadName, deadPlayerId}
 * }}
 */
function lockActions(w) {
  const A = { wolf: { target: null }, guard: { target: null }, detective: { target: null }, accomplice: { target: null }, thief: { target: null }, gambler: { target: null, claim: null }, forensics: { active: false, deadPlayerId: null, deadName: null } };
  const alive = alivePlayers(w);

  // 上一夜死者（法医本夜去现场取材的对象）；仅当法医存活且第二夜起生效
  const forensics = w.players.find((p) => p.role === 'forensics' && p.alive);
  const prevKill = [...w.deaths].reverse().find((d) => d.cause === 'night');
  if (forensics && w.round >= 2 && prevKill) {
    A.forensics = { active: true, deadPlayerId: prevKill.playerId, deadName: prevKill.name };
  }

  // 狼人：刀一人（不能刀狼方自己人；首夜不可刀文员）
  const wolf = w.players.find((p) => p.role === 'wolf' && p.alive);
  if (wolf) {
    const pool = alive.filter((p) => !EVIL_ROLES.includes(p.role) && (w.round !== 1 || p.role !== 'clerk'));
    let t = findPlayer(w, w.suspect[wolf.id]);
    if (t && t.alive && !EVIL_ROLES.includes(t.role) && (w.round !== 1 || t.role !== 'clerk')) {
      A.wolf.target = t.id;
    } else if (pool.length) {
      A.wolf.target = pool[Math.floor(Math.random() * pool.length)].id;
    }
  }

  // 守卫：保护一人（可自保；不能连续两夜同一人）
  const guard = w.players.find((p) => p.role === 'guard' && p.alive);
  if (guard) {
    const pool = alive.filter((p) => p.id !== w.lastGuardTarget);
    A.guard.target = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : guard.id;
  }

  // 侦探 / 帮凶 / 小偷：各拜访一人
  for (const role of ['detective', 'accomplice', 'thief']) {
    const p = w.players.find((x) => x.role === role && x.alive);
    if (p) {
      const pool = alive.filter((x) => x.id !== p.id);
      A[role].target = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
    }
  }

  // 赌徒：猜一人 + 猜阵营
  const gambler = w.players.find((p) => p.role === 'gambler' && p.alive);
  if (gambler) {
    const pool = alive.filter((p) => p.id !== gambler.id);
    if (pool.length) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      A.gambler.target = t.id;
      // 60% 概率猜'好人'（好人占多数，利于获得正面信息），否则随机
      const roll = Math.random();
      if (roll < 0.6) A.gambler.claim = campOf(t.role) === 'good' ? 'good' : shuffle(['good', campOf(t.role)])[0];
      else A.gambler.claim = shuffle(['good', 'neutral', 'evil'])[0];
    }
  }
  return A;
}

/**
 * 小偷效果（阶段 3+8）：依赖当前迷醉集合，迷醉恢复后需重算。
 * @returns {{ forgotten:Set, thiefHitsWolf:boolean }}
 */
function calcThiefEffect(w, A, drunk) {
  const forgotten = new Set();
  let thiefHitsWolf = false;
  const thief = w.players.find((p) => p.role === 'thief' && p.alive);
  if (thief && !drunk.has(thief.id) && A.thief.target) {
    const t = findPlayer(w, A.thief.target);
    if (t && t.role === 'wolf') thiefHitsWolf = true;
    else forgotten.add(A.thief.target);
  }
  return { forgotten, thiefHitsWolf };
}

/**
 * 结算一夜（阶段 2~9 全部确定性逻辑），并直接落盘死亡名单。
 *
 * 两遍修正：酒鬼"若本夜被狼刀死亡则不触发迷醉"存在循环依赖
 * （迷醉 → 守卫/狼有效性 → 酒鬼是否被刀死 → 是否触发迷醉）。
 * 处置：先按"酒鬼存活"算一遍；若酒鬼进入死亡名单，则取消迷醉并重算守卫/狼刀/小偷。
 */
function settleNight(game) {
  const w = game.deduction;
  processTurn(w); // 阶段 0：变身（夜晚开始）

  const A = lockActions(w); // 阶段 1：锁定行动

  const drunkard = w.players.find((p) => p.role === 'drunkard' && p.alive);

  // 拜访事件表（阶段 2 素材）：detective/accomplice/thief/guard 的拜访。狼刀不算、法医去现场不算。
  const visits = [
    { v: A.detective.target, r: 'detective' },
    { v: A.accomplice.target, r: 'accomplice' },
    { v: A.thief.target, r: 'thief' },
    { v: A.guard.target, r: 'guard' },
  ].filter((x) => x.v);
  const visitedBy = {}; // targetId -> [visitorRole...]
  for (const x of visits) if (x.v) (visitedBy[x.v] = visitedBy[x.v] || []).push(x.r);

  // 本夜「出门过」的人（侦探线索、被拜访信息用）：
  // 狼/侦探/帮凶/小偷/守卫 存活即出动（迷醉/遗忘只影响技能，人已出门）；法医第二夜起（有尸体）出门。
  const leavers = [];
  for (const rid of ['wolf', 'detective', 'accomplice', 'thief', 'guard']) {
    const p = w.players.find((x) => x.role === rid && x.alive);
    if (p) leavers.push(p.id);
  }
  if (A.forensics.active) {
    const f = w.players.find((x) => x.role === 'forensics' && x.alive);
    if (f) leavers.push(f.id);
  }

  // —— 阶段 2：迷醉（先按酒鬼存活算）——
  const drunkId = drunkard ? drunkard.id : null;
  let drunk = new Set();
  if (drunkId) {
    const visitors = (visitedBy[drunkId] || []).map((r) => roleToId(w, r)).filter(Boolean);
    visitors.forEach((id) => drunk.add(id));
  }

  // —— 阶段 3：小偷遗忘标记 ——
  let { forgotten, thiefHitsWolf } = calcThiefEffect(w, A, drunk);

  // —— 阶段 4/5/6 结算（pass 1：酒鬼默认存活）——
  let result = executeNightActions(w, A, drunk, forgotten, thiefHitsWolf);

  // —— 两遍修正：酒鬼被刀死 → 迷醉不触发，全部重算 ——
  if (drunkId && result.killed && result.killed.id === drunkId) {
    drunk = new Set();
    ({ forgotten, thiefHitsWolf } = calcThiefEffect(w, A, drunk));
    result = executeNightActions(w, A, drunk, forgotten, thiefHitsWolf);
  }

  // —— 阶段 7：死亡判定 + 落盘（先落盘，供阶段8小偷复制判断）——
  const nightDeaths = [];
  if (result.killed) nightDeaths.push({ playerId: result.killed.id, cause: 'wolf' });
  if (result.gamblerDied) nightDeaths.push({ playerId: result.gamblerDied, cause: 'gambler' });

  // 直接落盘死亡（本轮夜间死者）
  for (const d of nightDeaths) {
    const p = findPlayer(w, d.playerId);
    if (!p || !p.alive) continue;
    p.alive = false;
    w.deaths.push({ round: w.round, playerId: p.id, name: p.name, cause: 'night', role: p.role, roleBackup: p.role });
  }

  // —— 阶段 8：小偷复制修正（依据最终死亡名单——目标已死亡者被复制）——
  const thiefP = w.players.find((p) => p.role === 'thief' && p.alive);
  let copiedRole = null;
  let copiedName = '';
  if (thiefP && !drunk.has(thiefP.id) && A.thief.target) {
    const t = findPlayer(w, A.thief.target);
    if (t && !t.alive) {
      copiedRole = t.role;
      copiedName = t.name;
    }
  }

  const gamblerP = findPlayer(w, A.gambler.target);
  w.night = {
    round: w.round,
    // 狼刀
    wolfTarget: result.wolfTarget,
    wolfBlocked: result.wolfBlocked,
    wolfForgot: result.wolfForgot,
    killedByWolf: result.killed ? result.killed.id : null,
    // 守卫
    guardTarget: result.guardTarget,
    guardEffective: result.guardEffective,
    // 侦探
    detectiveTarget: A.detective.target,
    // 法医
    forensicsActive: A.forensics.active,
    forensicsDeadName: A.forensics.deadName,
    forensicsDeadRole: A.forensics.active ? (() => {
      const dp = w.deaths.slice().reverse().find((d) => d.cause === 'night' && d.name === A.forensics.deadName);
      return dp ? dp.role : null;
    })() : null,
    // 被拜访（村民/文员等收信息）
    visitedBy,
    // 本夜出门者（侦探线索）
    leavers,
    // 赌徒
    gamblerTarget: A.gambler.target,
    gamblerClaim: A.gambler.claim,
    gamblerCorrect: result.gamblerCorrect,
    gamblerForgot: forgotten.has(roleToId(w, 'gambler')),
    gamblerTargetCamp: gamblerP ? CAMP[campOf(gamblerP.role)] : null,
    // 小偷
    thiefTarget: A.thief.target,
    thiefCopiedRole: copiedRole,
    thiefCopiedName: copiedName,
    // 迷醉 / 遗忘
    drunkIds: [...drunk],
    forgottenIds: [...forgotten],
    // 变身
    turnedPlayerId: w.turned ? w.turned.playerId : null,
  };

  // —— 逐夜行动日志（供终局「逐夜行动回顾」）——
  const nameOf = (id) => { const p = findPlayer(w, id); return p ? p.name : ''; };
  w.nightLogs.push({
    round: w.round,
    wolf: A.wolf.target
      ? { target: nameOf(A.wolf.target), killed: result.killed ? result.killed.name : null, blocked: result.wolfBlocked }
      : null,
    guard: A.guard.target ? nameOf(A.guard.target) : null,
    detective: A.detective.target
      ? { target: nameOf(A.detective.target), clue: (leavers || []).includes(A.detective.target) ? '出门' : '在家' }
      : null,
    accomplice: A.accomplice.target ? nameOf(A.accomplice.target) : null,
    thief: A.thief.target
      ? { target: nameOf(A.thief.target), effect: copiedRole ? `复制了「${nameOf(A.thief.target)}」的能力` : forgotten.size ? '清除了目标记忆' : thiefHitsWolf ? '干扰了狼人（狼刀失效）' : null }
      : null,
    gambler: A.gambler.target
      ? { target: nameOf(A.gambler.target), claim: CAMP[A.gambler.claim] || A.gambler.claim, correct: result.gamblerCorrect, forgot: result.gamblerForgot, died: result.gamblerDied ? nameOf(result.gamblerDied) : null }
      : null,
    forensics: A.forensics.active
      ? { target: A.forensics.deadName || '', role: w.night.forensicsDeadRole ? ROLES[w.night.forensicsDeadRole] : null }
      : null,
    drunkAffected: [...drunk].map(nameOf).filter(Boolean),
    forgotten: [...forgotten].map(nameOf).filter(Boolean),
    deaths: nightDeaths.map((d) => nameOf(d.playerId)).filter(Boolean),
  });

  return result.killed;
}

function roleToId(w, role) {
  const p = w.players.find((x) => x.role === role && x.alive);
  return p ? p.id : '';
}

/**
 * 结算"守卫 → 狼刀 → 赌徒"，产出 kill 与各角色私有信息。
 * 注意：本函数不修改玩家 alive（死亡统一由 settleNight 落盘）。
 */
function executeNightActions(w, A, drunk, forgotten, thiefHitsWolf) {
  const guard = w.players.find((p) => p.role === 'guard' && p.alive);
  const wolf = w.players.find((p) => p.role === 'wolf' && p.alive);
  const gambler = w.players.find((p) => p.role === 'gambler' && p.alive);

  // 守卫：保护是否有效（未迷醉/未遗忘才生效）
  const guardEffective = !!(guard && !drunk.has(guard.id) && !forgotten.has(guard.id) && A.guard.target);

  // 狼刀：狼被小偷遗忘 → 本夜无刀
  const wolfForgot = !!(wolf && thiefHitsWolf);
  const wolfDrunk = !!(wolf && drunk.has(wolf.id));
  const wolfActive = !!(wolf && !wolfForgot && !wolfDrunk);
  let killed = null;
  let wolfBlocked = false;
  if (wolfActive && A.wolf.target) {
    if (guardEffective && A.guard.target === A.wolf.target) {
      wolfBlocked = true;
    } else {
      killed = findPlayer(w, A.wolf.target);
    }
  }

  // 赌徒：被遗忘则无法猜测；猜错立即死亡
  const gamblerForgot = !!(gambler && forgotten.has(gambler.id));
  let gamblerCorrect = false;
  let gamblerDied = null;
  if (gambler && !gamblerForgot && A.gambler.target) {
    const t = findPlayer(w, A.gambler.target);
    if (t) {
      gamblerCorrect = campOf(t.role) === A.gambler.claim;
      if (!gamblerCorrect) gamblerDied = gambler.id;
    }
  }

  return {
    guardTarget: A.guard.target,
    guardEffective,
    wolfTarget: A.wolf.target,
    wolfBlocked,
    wolfForgot,
    killed: killed ? { id: killed.id, name: killed.name } : null,
    gamblerTarget: A.gambler.target,
    gamblerClaim: A.gambler.claim,
    gamblerCorrect,
    gamblerDied,
  };
}

/** 胜负判定：'good' | 'wolf' | null */
function checkWinner(w) {
  const aliveWolf = w.players.some((p) => p.role === 'wolf' && p.alive);
  if (!aliveWolf) {
    // 狼死但坏人同伴还存活 → 会变身，游戏继续
    const aliveBad = w.players.some((p) => (p.role === 'accomplice' || p.role === 'drunkard') && p.alive);
    if (!aliveBad) return 'good';
    return null;
  }
  const aliveGood = w.players.some((p) => GOOD_ROLES.includes(p.role) && p.alive);
  if (!aliveGood) return 'wolf';
  return null;
}

// ==================== 叙事模板（仅开局/天亮/裁决，MVP 不调 LLM） ====================

function buildDawnNarrative(game, isFirstNight) {
  const w = game.deduction;
  const alive = alivePlayers(w);
  const names = alive.map((p) => p.name).join('、');
  const deadNames = w.deaths
    .filter((d) => d.round === w.round && d.cause === 'night')
    .map((d) => d.name);
  const deathText = deadNames.length
    ? `昨夜，黑暗夺走了「${deadNames.join('」「')}」的生命——尸体在清晨被发现，身份未知。`
    : '昨夜风平浪静，没有人死去。';
  const dayTag = isFirstNight ? '天亮了。' : `—— 第 ${w.round} 天 ——\n\n天亮了。`;
  return (
    `${dayTag}${deathText}\n\n现在，村里还活着的人：${names}。\n\n` +
    `（你是法官——不参与游戏，只负责裁决。请听完大家的发言后，决定是否处刑某人。）\n\n` +
    `白天的规则：每人发言一次，然后由你裁决——处刑最可疑的人（公开其身份牌），或放弃处刑直接进入下一夜。\n\n` +
    `（请开始听取发言。）`
  );
}

function buildEndNarrative(w, lastExiled) {
  const reveal = w.players.map((p) => `  ${p.name}：${ROLES[p.role]}`).join('\n');
  const wolfNames = w.players.filter((p) => p.role === 'wolf').map((p) => p.name).join('、');
  if (w.phase === 'win') {
    return `所有狼人已被处刑——${wolfNames}。村庄恢复宁静，好人阵营获胜！${buildNightReview(w)}`;
  }
  if (lastExiled) {
    return (
      `「${lastExiled.name}」被处刑，身份公开：【${ROLES[lastExiled.role]}】——可惜，那不是狼人。\n\n` +
      `好人阵营的力量已经耗尽，狼人「${wolfNames}」仍然潜伏在阴影中。狼人获胜。${buildNightReview(w)}`
    );
  }
  return `好人阵营已经失去了反击的力量，狼人「${wolfNames}」潜伏在村庄中。狼人获胜。${buildNightReview(w)}`;
}

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

/** 终局「逐夜行动回顾」：复盘每晚各方行动与结果 */
function buildNightReview(w) {
  const logs = w.nightLogs || [];
  if (!logs.length) return '';
  const parts = ['\n\n—— 逐夜行动回顾 ——'];
  for (const l of logs) {
    const line = [`【第 ${l.round} 夜】`];
    if (l.wolf) line.push(l.wolf.blocked ? `狼人袭击「${l.wolf.target}」但被守卫挡下` : `狼人刀杀「${l.wolf.killed || l.wolf.target}」`);
    if (l.guard) line.push(`守卫保护「${l.guard}」`);
    if (l.detective) line.push(`侦探探访「${l.detective.target}」（${l.detective.clue}）`);
    if (l.accomplice) line.push(`帮凶拜访「${l.accomplice}」`);
    if (l.thief) line.push(`小偷造访「${l.thief.target}」${l.thief.effect ? '，' + l.thief.effect : ''}`);
    if (l.gambler) {
      if (l.gambler.forgot) line.push(`赌徒本欲猜测「${l.gambler.target}」但被清除记忆，未能行动`);
      else line.push(`赌徒猜「${l.gambler.target}」为${l.gambler.claim}（${l.gambler.correct ? '正确' : '错误'}${l.gambler.died ? '，赌徒不幸殒命' : ''}）`);
    }
    if (l.forensics && l.forensics.role) line.push(`法医鉴明死难者「${l.forensics.target}」身份为${l.forensics.role}`);
    if (l.drunkAffected && l.drunkAffected.length) line.push(`酒鬼迷醉：${l.drunkAffected.join('、')}`);
    if (l.deaths && l.deaths.length) line.push(`本夜逝去：${l.deaths.join('、')}`);
    parts.push(line.join('；'));
  }
  return parts.join('\n');
}

// ==================== 私有知识包（白天发言素材） ====================

/**
 * 生成某角色的私有知识包（程序校验后的硬信息），供 LLM 组织第一人称发言。
 * 被迷醉/遗忘者直接返回"忘记了"固定语句（硬规则，不走 LLM）。
 */
function buildRoleKnowledge(game, p) {
  const w = game.deduction;
  const night = w.night || {};
  const drunk = (night.drunkIds || []).includes(p.id);
  const forgotten = (night.forgottenIds || []).includes(p.id);
  const affected = drunk || forgotten;
  const lines = [];

  // 阵营 + 身份（含首轮强制声明的程序注入）
  const declared = p.cover || p.role;
  lines.push(`身份：真实身份是【${ROLES[p.role]}】（阵营：${CAMP[campOf(p.role)]}）。`);
  if (w.round === 1) {
    if (!EVIL_ROLES.includes(p.role)) {
      lines.push(`【首轮规则】你必须在发言中当众表明真实身份：「我是${ROLES[p.role]}」。`);
    } else if (NEUTRAL_ROLES.includes(p.role)) {
      lines.push(p.cover ? `【首轮规则】你选择伪装：当众声称「我是${ROLES[p.cover]}」，可以编造与其相符的信息。` : `【首轮规则】你选择如实声明真实身份：「我是${ROLES[p.role]}」。`);
    } else {
      lines.push(`【首轮规则】你必须伪装：当众声称「我是${ROLES[declared]}」，绝不暴露真实身份；据此编造可信信息。`);
    }
  }

  // 文员：公布角色名单
  if (p.role === 'clerk') {
    lines.push(`你掌握村庄角色名册：本局存在的角色有——${w.rolePoolName.join('、')}（你只知道名单，不知道谁对应谁）。`);
    if (w.round === 1) lines.push(`首轮你应当公布该名单（这是你最关键的职责）。`);
  } else if (p.role === 'wolf') {
    const target = findPlayer(w, night.killedByWolf);
    // 狼人知道自己的真实行动，但提示词约束绝不能在发言中承认
    lines.push(`【内部情报·绝不外泄】你昨夜${target ? `刀杀了「${target.name}」` : '未能得手'}。这是你的真实行动，但【绝对不能】在发言中提及或暗示你刀了谁。`);
    const partner = w.players.find((q) => (q.role === 'accomplice' || q.role === 'drunkard') && q.alive);
    lines.push(partner ? `你的同伙是「${partner.name}」（阵营坏人，尚未暴露）。【绝不外泄】` : `你的同伙已不在。`);
    // 狼人伪装身份的夜间行为素材
    const coverName = ROLES[declared];
    lines.push(`【伪装行为·发言用】你声称自己是「${coverName}」。据此编造与该身份一致的夜间行为陈述：`);
    if (declared === 'villager') {
      lines.push(`如「我昨夜整夜在家，没有人来拜访」或「我听到些动静但没在意」。`);
    } else if (declared === 'detective') {
      const fake = alivePlayers(w).find((x) => x.id !== p.id);
      lines.push(fake ? `如「我昨夜拜访了${fake.name}，他呆在家中」或「他出门了」（编造一条线索，需与你的伪装身份一致）。` : `如「我昨夜出门侦察了一下」。`);
    } else if (declared === 'guard') {
      const fake = alivePlayers(w).find((x) => x.id !== p.id);
      lines.push(fake ? `如「我昨夜保护了${fake.name}，无事发生」。（编造保护行为，但不能声称挡下了狼刀——那会暴露你与真实狼刀目标重合）` : `如「我昨夜守了一处地方，无事发生」。`);
    } else if (declared === 'forensics') {
      lines.push(`如「昨夜没有可供检验的尸体」或「我还在等待案情」。`);
    } else {
      lines.push(`编造一条与你声称身份一致的日常陈述。`);
    }
  } else if (p.role === 'accomplice') {
    // 帮凶也需按伪装身份编造夜间行为（同狼人素材逻辑）
    const coverName = ROLES[declared];
    lines.push(`【伪装行为·发言用】你声称自己是「${coverName}」。据此编造与该身份一致的夜间行为陈述：`);
    if (declared === 'villager') {
      lines.push(`如「我昨夜整夜在家，没有人来拜访」。`);
    } else if (declared === 'detective') {
      const fake = alivePlayers(w).find((x) => x.id !== p.id);
      lines.push(fake ? `如「我昨夜拜访了${fake.name}，他呆在家中」（编造一条线索）。` : `如「我昨夜出门侦察了一下」。`);
    } else if (declared === 'guard') {
      const fake = alivePlayers(w).find((x) => x.id !== p.id);
      lines.push(fake ? `如「我昨夜保护了${fake.name}，无事发生」。（编造保护行为）` : `如「我昨夜守了一处地方，无事发生」。`);
    } else if (declared === 'forensics') {
      lines.push(`如「昨夜没有可供检验的新尸体」。`);
    } else {
      lines.push(`编造一条与你声称身份一致的日常陈述。`);
    }
  } else if (p.role === 'drunkard') {
    // 酒鬼不出门无技能，但同样需要按伪装身份做首轮声明素材
    const coverName = ROLES[declared];
    lines.push(`【伪装行为·发言用】你声称自己是「${coverName}」。据此编造与该身份一致的夜间行为陈述：`);
    if (declared === 'villager') {
      lines.push(`如「我昨夜整夜在家，没有人来拜访」。`);
    } else if (declared === 'detective') {
      const fake = alivePlayers(w).find((x) => x.id !== p.id);
      lines.push(fake ? `如「我昨夜拜访了${fake.name}，他呆在家中」（编造一条线索）。` : `如「我昨夜出门侦察了一下」。`);
    } else if (declared === 'guard') {
      const fake = alivePlayers(w).find((x) => x.id !== p.id);
      lines.push(fake ? `如「我昨夜保护了${fake.name}，无事发生」。（编造保护行为）` : `如「我昨夜守了一处地方，无事发生」。`);
    } else if (declared === 'forensics') {
      lines.push(`如「昨夜没有可供检验的新尸体」。`);
    } else {
      lines.push(`编造一条与你声称身份一致的日常陈述。`);
    }
  }

  if (affected) {
    lines.push(`【本夜状态】你昨夜${drunk ? '被酒鬼迷醉' : '被小偷清除记忆'}——技能无效，且你不记得昨夜发生了什么事。你的发言只能用一句话表达：「我……抱歉，我完全不记得昨夜做了什么。」`);
    return lines;
  }

  // 中性/其他角色的伪装一致性提示：若声称身份≠真实身份，禁止提及真实中立夜间活动
  if (NEUTRAL_ROLES.includes(p.role) && p.cover && p.cover !== p.role) {
    lines.push(`【伪装纪律】你声称自己是「${ROLES[p.cover]}」。因此【不要】在发言中提及你真实的中立行动线索（如小偷的"清除记忆/复制能力"、赌博猜测过程），只能用与「${ROLES[p.cover]}」身份相符的陈述。`);
  }

  // 技能结果（未被迷醉/遗忘）
  switch (p.role) {
    case 'guard': {
      const t = findPlayer(w, night.guardTarget);
      const name = t ? t.name : '';
      if (night.wolfBlocked && night.guardTarget === night.wolfTarget) {
        lines.push(`你昨夜守护了「${name}」，并成功挡下了狼人的袭击——他活了下来。`);
      } else {
        lines.push(`你昨夜守护了「${name}」，没有遭遇袭击事件。`);
      }
      break;
    }
    case 'detective': {
      const t = findPlayer(w, night.detectiveTarget);
      if (t) {
        const out = (night.leavers || []).includes(t.id);
        lines.push(`你昨夜暗中探访了「${t.name}」。你的线索：他昨夜${out ? '曾外出活动' : '没有外出活动（一直待在住所）'}。注意：「没有外出」不等于「安全」——狼人可以在住所内行凶。`);
      } else {
        lines.push(`你昨夜没有探访到合适的目标。`);
      }
      break;
    }
    case 'forensics': {
      if (night.forensicsActive && night.forensicsDeadRole) {
        lines.push(`你昨夜前往上一案发现场，验明了死者「${night.forensicsDeadName}」的真实身份——${ROLES[night.forensicsDeadRole]}。这是你今天可以公布的铁证。`);
      } else {
        lines.push(`昨夜没有可供检验的新尸体。`);
      }
      break;
    }
    case 'clerk':
      break; // 名单已在上方注入
    case 'villager': {
      const visitors = night.visitedBy[p.id] || [];
      if (visitors.length) {
        const vs = visitors.map((r) => ROLES[r]);
        lines.push(`昨夜有人来访过你：${vs.join('、')}。除此之外你整夜在家。`);
      } else {
        lines.push(`你昨夜整夜在家，无人来访。`);
      }
      break;
    }
    case 'gambler': {
      if (night.gamblerForgot) {
        lines.push(`你昨夜被小偷清除了记忆，未能完成猜测。`);
      } else if (night.gamblerTarget) {
        const t = findPlayer(w, night.gamblerTarget);
        if (night.gamblerCorrect) {
          lines.push(`你昨夜赌对了：你查验的「${t ? t.name : ''}」的阵营是${night.gamblerTargetCamp || '未知'}。这是你今天可以公布的信息。`);
        } else {
          lines.push(`你昨夜赌错了——但你侥幸活了下来，只是没能获得任何信息。`);
        }
      }
      break;
    }
    case 'thief': {
      const t = findPlayer(w, night.thiefTarget);
      const tName = t ? t.name : '';
      if (night.thiefCopiedRole) {
        lines.push(`你昨夜造访了「${tName}」，他已经死了——你复制了他的能力（${ROLES[night.thiefCopiedRole]}），今天可以透露相关信息一次。`);
      } else if (night.wolfForgot) {
        lines.push(`你昨夜造访了「${tName}」，但你的手段没能生效。`);
      } else if (tName) {
        lines.push(`你昨夜造访了「${tName}」，并清除了他本夜的记忆（他的技能失效了）。`);
      }
      break;
    }
    case 'accomplice': {
      const wolf = w.players.find((q) => q.role === 'wolf' && q.alive);
      lines.push(wolf ? `你清楚狼人是「${wolf.name}」。你可以为他掩护或转移注意力。` : `狼人已死，你随时可能接手狼人之位。`);
      break;
    }
  }
  return lines;
}

function buildSpeechPrompt(game, speaker) {
  const w = game.deduction;
  const alive = alivePlayers(w);
  const aliveList = alive.map((p) => p.name).join('、');
  const prior = w.speeches
    .filter((s) => s.round === w.round && s.playerId !== speaker.id)
    .map((s) => `${s.name}：${s.speech}`)
    .join('\n');

  const night = w.night || {};
  const drunk = (night.drunkIds || []).includes(speaker.id);
  const forgotten = (night.forgottenIds || []).includes(speaker.id);
  if (drunk || forgotten) {
    return { affected: true };
  }

  const knowledge = buildRoleKnowledge(game, speaker).join('\n');

  const factLine =
    `【发言风格 — 最高原则】\n` +
    `1. 只输出有价值信息：按上述素材交代【身份 / 技能结果 / 亲历事件】，2~3 句话，控制在 40~90 字。\n` +
    `2. 杜绝废话：不寒暄、不喊口号、不重复他人、不空泛地"我觉得X可疑"、不请求大家。用陈述句。\n` +
    `3. 诚实角色说真话；坏人按上述【伪装行为】编造合理细节伪装；中立自选。\n` +
    `4. 【绝对禁止】坏人（狼人/帮凶/酒鬼）在发言中提及或暗示自己的真实夜间行动（如"我刀了X"）。只能按伪装身份编造行为。违反此条等于自曝。\n` +
    `5. 【游戏常识·重要】「呆在家中」或「没有外出」不等于「没被袭击」——狼人可以在住所内行凶。不要用「他在家」去反驳「他被刀了」，这是错误的逻辑。\n` +
    `6. 发言中不要重复别人已经说过的话，只补充自己独有的新信息或对他人信息的判断。`;

  return {
    system: [
      `你是狼人杀类游戏「推理杀」中的玩家「${speaker.name}」，正在参加一局 ${GAME_SIZE} 人局。法官正在旁观并会裁决。`,
      knowledge,
      factLine,
      `存活玩家：${aliveList}。`,
      prior ? `到目前为止的发言（按顺序）：\n${prior}` : '你是本轮第一个发言的人。',
      '现在轮到你发言。请只输出一个 JSON 对象（不要任何解释、不要代码块标记）：',
      '{"speech":"你的发言，第一人称","suspect":"pX"}',
      '要求：',
      '- speech：按上述素材说话，第一人称，40~90 字，信息密度优先。',
      '- suspect：你认为最可疑的玩家编号（存活者、非自己）；无实据则填自己。',
      '- 【重要】suspect 必须与发言正文一致，发言质疑谁就填谁。',
    ].join('\n'),
  };
}

function pickSuspect(game, voter, raw) {
  const w = game.deduction;
  const rawId = String(raw || '').trim();
  const target = findPlayer(w, rawId);
  if (rawId === voter.id) return voter.id;
  if (target && target.alive && target.id !== voter.id) return target.id;
  const pool = alivePlayers(w).filter((p) => p.id !== voter.id);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : '';
}

function suspectFromSpeech(w, voter, speech) {
  const text = String(speech || '');
  for (const p of alivePlayers(w)) {
    if (p.id === voter.id) continue;
    if (text.includes(p.name)) return p.id;
  }
  return null;
}

/** 从发言文本提取"我是X"声明；提取不到返回空 */
function extractClaim(speech) {
  const m = String(speech || '').match(/我是(文员|侦探|村民|法医|守卫|赌徒|小偷|狼人|帮凶|酒鬼)/);
  return m ? m[1] : '';
}

/**
 * LLM 发言失败时的兜底发言（保证不与自称矛盾、不做无谓"斟酌"）。
 * 基于角色知识包生成真实、克制的陈述句；坏人只用安全话术，不泄露身份。
 */
function fallbackSpeech(game, speaker) {
  const w = game.deduction;
  const declared = ROLES[speaker.cover || speaker.role];
  const part = [`我是${declared}。`];
  if (EVIL_ROLES.includes(speaker.role)) {
    // 坏人兜底：按伪装身份编造安全话术
    const cover = speaker.cover || 'villager';
    const others = alivePlayers(w).filter((p) => p.id !== speaker.id);
    const fake = others.length ? others[Math.floor(Math.random() * others.length)].name : '';
    if (cover === 'villager') {
      part.push('昨夜我整夜在家，没有人来拜访。');
    } else if (cover === 'detective') {
      part.push(fake ? `昨夜我拜访了${fake}，他呆在家中。` : '昨夜我出门看了看，没什么异常。');
    } else if (cover === 'guard') {
      part.push(fake ? `昨夜我保护了${fake}，无事发生。` : '昨夜我守了一夜，无事发生。');
    } else if (cover === 'forensics') {
      part.push('昨夜没有可供检验的尸体。');
    } else {
      part.push('昨夜我大多待在家里，没有特别的发现。');
    }
  } else {
    const k = buildRoleKnowledge(game, speaker);
    for (const line of k) {
      if (/我昨|我拜访|我守护|我复制|我猜测|我整夜|有人来|我掌握|我前往/.test(line)) {
        part.push(line.replace(/你的/g, '我的').replace(/你/g, '我'));
      }
    }
  }
  return part.slice(0, 2).join('').slice(0, MAX_SPEECH);
}

/** 生成单个 AI 的发言；失败/被迷醉遗忘时回落模板（保证回合不断） */
async function generateSpeech(game, speaker) {
  const w = game.deduction;
  const built = buildSpeechPrompt(game, speaker);
  if (built.affected) {
    return {
      speech: '我……抱歉，我完全不记得昨夜发生了什么。',
      suspect: '',
      affected: true,
    };
  }
  try {
    const text = await chat(
      [
        { role: 'system', content: built.system },
        { role: 'user', content: '请发表你的发言。' },
      ],
      { temperature: 0.8, maxTokens: 320 }
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
    return { speech: fallbackSpeech(game, speaker), suspect: '' };
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
    // 注意：不再直接把完整角色名册交给前端（那是文员的职责/信息价值）。
    players: w.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, isPlayer: false })),
    claims: (w.claims || []).map((c) => ({ playerId: c.playerId, name: c.name, claimed: c.claimed })), // 纯发言提取的自称身份
    deaths: w.deaths.map((d) => ({
      round: d.round,
      name: d.name,
      cause: d.cause, // night（不亮身份） | execute（亮身份）
      role: d.cause === 'execute' ? ROLES[d.role] : '',
    })),
    roles: over ? w.players.map((p) => ({ name: p.name, role: ROLES[p.role] })) : null,
    aliveCount: alivePlayers(w).length,
    canAdjudicate: w.phase === 'adjudicate',
    // 文员是否已公布名单（首轮文员真实发言后置 true；用于前端提示名单已公布）
    clerkPoolRevealed: !!w.players.find((p) => p.role === 'clerk' && p.didRevealPool),
    // 终局逐夜行动回顾
    nightLogs: over ? (w.nightLogs || []) : null,
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
    phase: 'day',
    round: 1,
    players: assignRoles(),
    speeches: [],
    suspect: {},
    deaths: [], // { round, playerId, name, cause, role, roleBackup }——role 为内部真实身份，快照隐藏
    night: null,
    rolePoolName: [],
    claims: [], // 已公开声称：{ playerId, name, claimed }
    winner: null,
    turned: null, // { playerId, round }——狼死人变身记录
    lastGuardTarget: null, // 守卫上一夜保护对象（不能连续两夜同一人）
    nightLogs: [], // 逐夜行动日志（终局回顾）
  };
  w.rolePoolName = rolePoolOf(w.players);

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
  settleNight(game); // 第一夜结算（内部落盘死亡）
  game.history.push({ role: 'assistant', content: buildDawnNarrative(game, true), choices: [] });
  return game;
}

/**
 * 白天：AI 依次发言（法官不发言），结束后进入裁决阶段。
 * 一次调用串行生成所有存活 AI 发言（每人一次 LLM，被迷醉/遗忘者走固定模板）。
 */
async function processAction(game, userInput, opts = {}) {
  const w = game.deduction;
  if (w.phase === 'win' || w.phase === 'lose') throw new Error('游戏已经结束');
  if (w.phase !== 'day') throw new Error('当前不是发言阶段');

  const aiSpeeches = [];
  for (const p of w.players) {
    if (!p.alive) continue;
    const { speech, suspect } = await generateSpeech(game, p);
    w.speeches.push({ round: w.round, playerId: p.id, name: p.name, speech });
    w.suspect[p.id] = pickSuspect(game, p, suspect);
    // 自称身份：优先从发言文本提取"我是X"（诚实角色自然说出，坏人可能编造），提取不到再用程序注入值兜底
    if (!w.claims.find((c) => c.playerId === p.id)) {
      const claimed = extractClaim(speech) || ROLES[p.cover || p.role];
      w.claims.push({ playerId: p.id, name: p.name, claimed });
      // 首轮文员一旦真实发言（含名单或自称文员），即视为已完成名单公布
      if (w.round === 1 && p.role === 'clerk' && (!p.didRevealPool)) p.didRevealPool = true;
    }
    aiSpeeches.push(`「${p.name}」：${speech}`);
  }

  w.lastGuardTarget = (w.night && w.night.guardTarget) || w.lastGuardTarget;
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
 * 处刑 → 公开真实身份牌 → 校验胜负；放弃 → 进下一夜。
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
    w.deaths.push({ round: w.round, playerId: target.id, name: target.name, cause: 'execute', role: target.role, roleBackup: target.role });
  }

  let narrative = buildAdjudicateNarrative(w, target, isPass);

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
  settleNight(game);
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
  narrative += `\n\n${buildDawnNarrative(game, false)}`;
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
  if (w.phase === 'win') return { over: true, reason: 'win', message: '所有狼人被处刑，好人获胜' };
  if (w.phase === 'lose') return { over: true, reason: 'lose', message: '好人阵营全灭，狼人获胜' };
  return { over: false, reason: '', message: '' };
}

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
  needsLLM: false,
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
  // 供单元测试与工具层复用（无 LLM 依赖）
  __test: { pickSuspect, settleNight, checkWinner, assignRoles, processTurn },
};