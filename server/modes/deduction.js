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
  // 好人（标准局）
  clerk: '文员',
  detective: '侦探',
  villager: '村民',
  forensics: '法医',
  guard: '守卫',
  // 中立（标准局）
  gambler: '赌徒',
  thief: '小偷',
  // 坏人（标准局）
  wolf: '狼人',
  accomplice: '帮凶',
  drunkard: '酒鬼',
  // 好人（十人进阶局）
  watcher: '观者',
  postman: '邮差',
  walker: '行者',
  // 中立（十人进阶局）
  quack: '庸医',
  spy: '间谍',
  // 坏人（十人进阶局）
  clown: '小丑',
  warlock: '术士',
};

// 标准局角色池（7 人局，保持原玩法不变）
const GOOD_BASE = ['clerk', 'detective', 'villager', 'forensics', 'guard'];
const NEUTRAL_BASE = ['gambler', 'thief'];
const EVIL_BASE = ['wolf', 'accomplice', 'drunkard'];
// 全量角色池（阵营判定/伪装分配/自曝拦截等通用逻辑使用；新角色仅进入十人进阶局）
const GOOD_ROLES = [...GOOD_BASE, 'watcher', 'postman', 'walker'];
const NEUTRAL_ROLES = [...NEUTRAL_BASE, 'quack', 'spy'];
const EVIL_ROLES = [...EVIL_BASE, 'clown', 'warlock'];
// 变身继承顺序：狼死 → 帮凶 → 酒鬼 → 小丑 → 术士
const TURN_ORDER = ['accomplice', 'drunkard', 'clown', 'warlock'];
const CAMP = {
  good: '好人',
  neutral: '中立',
  evil: '坏人',
};
const ROLES_NAMES = { // 中文名 ——（对应英文 key）
  '文员': 'clerk', '侦探': 'detective', '村民': 'villager', '法医': 'forensics', '守卫': 'guard',
  '赌徒': 'gambler', '小偷': 'thief', '狼人': 'wolf', '帮凶': 'accomplice', '酒鬼': 'drunkard',
  '观者': 'watcher', '邮差': 'postman', '行者': 'walker', '庸医': 'quack', '间谍': 'spy', '小丑': 'clown', '术士': 'warlock',
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
function assignRoles(board = 'standard') {
  const size = board === 'advanced' ? 10 : GAME_SIZE;
  const names = shuffle(AI_NAMES).slice(0, size);
  let goods;
  let neutral;
  let evil;
  if (board === 'advanced') {
    // 十人进阶局：好人 5（8 选 5 不重复）+ 中立 2（4 选 2）+ 坏人 3（必含 1 狼，另 2 从帮凶/酒鬼/小丑/术士选 2）
    goods = shuffle(GOOD_ROLES).slice(0, 5);
    neutral = shuffle(NEUTRAL_ROLES).slice(0, 2);
    evil = ['wolf', ...shuffle(['accomplice', 'drunkard', 'clown', 'warlock']).slice(0, 2)];
  } else {
    // 七人标准局：原玩法完全不变
    goods = shuffle(GOOD_BASE).slice(0, 4);
    neutral = [shuffle(NEUTRAL_BASE)[0]];
    evil = ['wolf', shuffle(['accomplice', 'drunkard'])[0]];
  }
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
  // 中立随机：真身份 / 假身份（排除坏人已选伪装、其他中立已选伪装与自身真实身份，避免任何撞车）
  const usedCovers = evildoers.map((e) => e.cover);
  players.filter((p) => NEUTRAL_ROLES.includes(p.role)).forEach((p) => {
    if (Math.random() < 0.5) {
      p.cover = null; // 说真话
    } else {
      const rest = pool.filter((r) => r !== p.role && !usedCovers.includes(r));
      p.cover = rest.length ? rest[Math.floor(Math.random() * rest.length)] : null;
      if (p.cover) usedCovers.push(p.cover);
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
  const cand = w.players.filter((p) => TURN_ORDER.includes(p.role) && p.alive);
  const next = TURN_ORDER.map((r) => cand.find((p) => p.role === r)).find(Boolean);
  if (!next) return;
  next.roleBackup = next.role; // 保存原本身份，供终局复盘显示（帮凶/酒鬼 → 狼人）
  next.role = 'wolf';
  next.turnedRound = w.round; // 各自记录变身轮次（链式变身时每人独立保存）
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
  const A = { wolf: { who: null, target: null }, guard: { who: null, target: null }, detective: { who: null, target: null }, accomplice: { who: null, target: null }, thief: { who: null, target: null }, gambler: { who: null, target: null, claim: null }, forensics: { active: false, deadPlayerId: null, deadName: null }, watcher: { who: null, target: null }, postman: { who: null, target: null }, walker: { who: null, target: null }, spy: { who: null, target: null }, clown: { who: null, target: null }, warlock: { who: null, links: [] }, quackVisited: [] };
  const alive = alivePlayers(w);

  // 上一夜死者（法医本夜去现场取材的对象）；仅当法医存活且第二夜起生效
  const forensics = w.players.find((p) => p.role === 'forensics' && p.alive);
  const prevKill = [...w.deaths].reverse().find((d) => d.cause === 'night');
  if (forensics && w.round >= 2 && prevKill) {
    A.forensics = { active: true, who: forensics.id, deadPlayerId: prevKill.playerId, deadName: prevKill.name };
  }

  // 狼人：刀一人（不能刀狼方自己人；首夜不可刀文员）
  const wolf = w.players.find((p) => p.role === 'wolf' && p.alive);
  if (wolf) {
    A.wolf.who = wolf.id;
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
    A.guard.who = guard.id;
    const pool = alive.filter((p) => p.id !== w.lastGuardTarget);
    A.guard.target = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : guard.id;
  }

  // 侦探 / 帮凶 / 小偷：各拜访一人
  for (const role of ['detective', 'accomplice', 'thief']) {
    const p = w.players.find((x) => x.role === role && x.alive);
    if (p) {
      A[role].who = p.id;
      const pool = alive.filter((x) => x.id !== p.id);
      A[role].target = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
    }
  }

  // 赌徒：猜一人 + 猜阵营
  const gambler = w.players.find((p) => p.role === 'gambler' && p.alive);
  if (gambler) {
    A.gambler.who = gambler.id;
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

  // —— 十人进阶局角色（标准局不存在这些角色，以下自然不触发） ——
  // 观者：观测一人（观测不是拜访——不触发被拜访提示/迷醉/给药）
  const watcher = w.players.find((p) => p.role === 'watcher' && p.alive);
  if (watcher) {
    A.watcher.who = watcher.id;
    const pool = alive.filter((x) => x.id !== watcher.id);
    A.watcher.target = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
  }

  // 邮差 / 行者 / 间谍：各拜访一人
  for (const role of ['postman', 'walker', 'spy']) {
    const p = w.players.find((x) => x.role === role && x.alive);
    if (p) {
      A[role].who = p.id;
      const pool = alive.filter((x) => x.id !== p.id);
      A[role].target = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
    }
  }

  // 小丑：拜访一人（只拜访好人/中立；排除文员——角色名单是越常信息无法扭曲；排除庸医——拜访庸医等于服毒自杀）
  const clown = w.players.find((p) => p.role === 'clown' && p.alive);
  if (clown) {
    A.clown.who = clown.id;
    const pool = alive.filter((x) => x.id !== clown.id && !EVIL_ROLES.includes(x.role) && x.role !== 'clerk' && x.role !== 'quack');
    A.clown.target = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
  }

  // 术士：链接两人命运（只链接好人/中立，两人互不相同）
  const warlock = w.players.find((p) => p.role === 'warlock' && p.alive);
  if (warlock) {
    A.warlock.who = warlock.id;
    const pool = shuffle(alive.filter((x) => !EVIL_ROLES.includes(x.role)));
    if (pool.length >= 2) A.warlock.links = [pool[0].id, pool[1].id];
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

  // 拜访事件表（阶段 2 素材）：detective/accomplice/thief/guard + 进阶局 postman/walker/spy/clown 的拜访。狼刀不算、法医去现场不算、观者观测不算、术士链接不算。
  const visits = [
    { v: A.detective.target, r: 'detective' },
    { v: A.accomplice.target, r: 'accomplice' },
    { v: A.thief.target, r: 'thief' },
    { v: A.guard.target, r: 'guard' },
    { v: A.postman.target, r: 'postman' },
    { v: A.walker.target, r: 'walker' },
    { v: A.spy.target, r: 'spy' },
    { v: A.clown.target, r: 'clown' },
  ].filter((x) => x.v);
  const visitedBy = {}; // targetId -> [visitorRole...]
  for (const x of visits) if (x.v) (visitedBy[x.v] = visitedBy[x.v] || []).push(x.r);

  // 本夜「出门过」的人（侦探线索、被拜访信息用）：
  // 狼/侦探/帮凶/小偷/守卫 存活即出动（迷醉/遗忘只影响技能，人已出门）；法医第二夜起（有尸体）出门。
  const leavers = [];
  for (const rid of ['wolf', 'detective', 'accomplice', 'thief', 'guard', 'postman', 'walker', 'spy', 'clown']) {
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

  // —— 阶段 7：死亡判定（含十人进阶局新角色；标准局无新角色自然跳过）——
  const nightDeaths = [];
  if (result.killed) nightDeaths.push({ playerId: result.killed.id, cause: 'wolf' });
  if (result.gamblerDied) nightDeaths.push({ playerId: result.gamblerDied, cause: 'gambler' });

  // 邮差修正：狼目标是邮差且其拜访对象为好人 → 狼人空刀，邮差得知自己是狼目标
  let postmanSaved = false;
  const postmanP = w.players.find((p) => p.role === 'postman' && p.alive);
  if (postmanP && result.killed && result.killed.id === postmanP.id && A.postman.target) {
    const pt = findPlayer(w, A.postman.target);
    if (pt && campOf(pt.role) === 'good') {
      result.killed = null;
      nightDeaths.length = 0;
      if (result.gamblerDied) nightDeaths.push({ playerId: result.gamblerDied, cause: 'gambler' });
      postmanSaved = true;
    }
  }

  // 行者同归：拜访对象为坏人 → 双双死亡（守卫不可挡，只挡狼刀）
  const walkerP = w.players.find((p) => p.role === 'walker' && p.alive);
  let walkerKill = null;
  if (walkerP && !drunk.has(walkerP.id) && !forgotten.has(walkerP.id) && A.walker.target) {
    const wt = findPlayer(w, A.walker.target);
    if (wt && EVIL_ROLES.includes(wt.role)) {
      walkerKill = { target: wt.id, walker: walkerP.id };
      nightDeaths.push({ playerId: wt.id, cause: 'walker' });
      nightDeaths.push({ playerId: walkerP.id, cause: 'walker' });
    }
  }

  // 庸医判定：拜访者本夜将死 → 救下（免疫后续连锁）；否则拜访者被毒杀
  const quackP = w.players.find((p) => p.role === 'quack' && p.alive);
  const quackSaves = [];
  const quackPoisons = [];
  const savedByQuack = new Set();
  if (quackP && !drunk.has(quackP.id) && !forgotten.has(quackP.id)) {
    const willDie = new Set(nightDeaths.map((d) => d.playerId));
    for (const role of ['detective', 'accomplice', 'thief', 'guard', 'postman', 'walker', 'spy', 'clown']) {
      if (A[role].target === quackP.id && A[role].who) {
        const visitor = findPlayer(w, A[role].who);
        if (!visitor || !visitor.alive) continue;
        if (willDie.has(visitor.id)) {
          savedByQuack.add(visitor.id);
          quackSaves.push(visitor.id);
        } else {
          nightDeaths.push({ playerId: visitor.id, cause: 'quack' });
          quackPoisons.push(visitor.id);
        }
      }
    }
  }

  // 术士连锁：被链接两人任一死亡 → 另一人同死（被庸医救下者免疫；只结算一轮）
  const warlockP = w.players.find((p) => p.role === 'warlock' && p.alive);
  const warlockChain = [];
  if (warlockP && !drunk.has(warlockP.id) && !forgotten.has(warlockP.id) && A.warlock.links.length === 2) {
    const deadNow = new Set(nightDeaths.map((d) => d.playerId).filter((id) => !savedByQuack.has(id)));
    for (const id of A.warlock.links) {
      const other = A.warlock.links.find((x) => x !== id);
      if (deadNow.has(id) && !deadNow.has(other) && !savedByQuack.has(other)) {
        const op = findPlayer(w, other);
        if (op && op.alive) {
          nightDeaths.push({ playerId: other, cause: 'warlock' });
          warlockChain.push(other);
          deadNow.add(other);
        }
      }
    }
  }

  // 落盘死亡（去重；被庸医救下者除外）
  const uniqueNightDeaths = [...new Map(nightDeaths.map((d) => [d.playerId, d])).values()];
  for (const d of uniqueNightDeaths) {
    if (savedByQuack.has(d.playerId)) continue;
    const p = findPlayer(w, d.playerId);
    if (!p || !p.alive) continue;
    p.alive = false;
    // 变身者死亡时优先保留原本身份（roleBackup），与终局复盘的身份轨迹一致
    w.deaths.push({ round: w.round, playerId: p.id, name: p.name, cause: 'night', role: p.role, roleBackup: p.roleBackup || p.role });
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
    // 小丑扭曲（被扭曲者明日撒谎；被遗忘者记忆已清空，『忘记了』优先）
    twistedIds: (A.clown.target && w.players.find((p) => p.role === 'clown' && p.alive) && !drunk.has(A.clown.who) && !forgotten.has(A.clown.who) && !forgotten.has(A.clown.target)) ? [A.clown.target] : [],
    // —— 十人进阶局角色 ——
    watcherTarget: A.watcher.target,
    watcherCamp: A.watcher.target ? CAMP[campOf(findPlayer(w, A.watcher.target).role)] : null,
    postmanTarget: A.postman.target,
    postmanSaved,
    walkerTarget: A.walker.target,
    walkerKillTarget: walkerKill ? walkerKill.target : null,
    spyTarget: A.spy.target,
    spyLie: A.spy.target ? campOf(findPlayer(w, A.spy.target).role) !== 'good' : false,
    clownTarget: A.clown.target,
    warlockLinks: A.warlock.links.slice(),
    warlockChain,
    quackSaves,
    quackPoisons,
    quackVisitors: quackP ? visits.filter((x) => x.v === quackP.id).map((x) => roleToId(w, x.r)).filter((id) => id && findPlayer(w, id).alive) : [],
  };

  // —— 逐夜行动日志（供终局「逐夜行动回顾」；用 A.*.who 记录执行者，兼容当夜死亡者）——
  const nameOf = (id) => { const p = findPlayer(w, id); return p ? p.name : ''; };
  // 死亡名单去重（同一个人可能同时死于狼刀与赌徒猜错）
  const uniqueDeaths = [...new Map(nightDeaths.filter((d) => !savedByQuack.has(d.playerId)).map((d) => [d.playerId, d])).values()];
  w.nightLogs.push({
    round: w.round,
    // 狼方行动
    wolf: A.wolf.target
      ? { who: nameOf(A.wolf.who), target: nameOf(A.wolf.target), killed: result.killed ? result.killed.name : null, blocked: result.wolfBlocked }
      : null,
    accomplice: A.accomplice.target
      ? { who: nameOf(A.accomplice.who), target: nameOf(A.accomplice.target) }
      : null,
    // 好人行动
    guard: A.guard.target
      ? { who: nameOf(A.guard.who), target: nameOf(A.guard.target), effective: result.guardEffective }
      : null,
    detective: A.detective.target
      ? { who: nameOf(A.detective.who), target: nameOf(A.detective.target), clue: (leavers || []).includes(A.detective.target) ? '出门' : '在家' }
      : null,
    forensics: A.forensics.active
      ? { who: nameOf(A.forensics.who), target: A.forensics.deadName || '', role: w.night.forensicsDeadRole ? ROLES[w.night.forensicsDeadRole] : null }
      : null,
    // 中立行动
    thief: A.thief.target
      ? { who: nameOf(A.thief.who), target: nameOf(A.thief.target), effect: copiedRole ? `获取了死者原本的动作信息` : forgotten.size ? '清除了目标记忆' : thiefHitsWolf ? '干扰了狼人（狼刀失效）' : null }
      : null,
    gambler: A.gambler.target
      ? { who: nameOf(A.gambler.who), target: nameOf(A.gambler.target), claim: CAMP[A.gambler.claim] || A.gambler.claim, correct: result.gamblerCorrect, forgot: result.gamblerForgot, died: result.gamblerDied ? nameOf(result.gamblerDied) : null }
      : null,
    // 酒鬼迷醉
    drunkard: drunkId ? { who: nameOf(drunkId), affected: [...drunk].map(nameOf).filter(Boolean) } : null,
    forgotten: [...forgotten].map(nameOf).filter(Boolean),
    // —— 十人进阶局角色 ——
    watcher: A.watcher.target ? { who: nameOf(A.watcher.who), target: nameOf(A.watcher.target), camp: CAMP[campOf(findPlayer(w, A.watcher.target).role)] } : null,
    postman: A.postman.target ? { who: nameOf(A.postman.who), target: nameOf(A.postman.target), saved: postmanSaved } : null,
    walker: A.walker.target ? { who: nameOf(A.walker.who), target: nameOf(A.walker.target), kill: walkerKill ? nameOf(walkerKill.target) : null } : null,
    spy: A.spy.target ? { who: nameOf(A.spy.who), target: nameOf(A.spy.target), lie: campOf(findPlayer(w, A.spy.target).role) !== 'good' } : null,
    clown: A.clown.target ? { who: nameOf(A.clown.who), target: nameOf(A.clown.target) } : null,
    warlock: A.warlock.links.length === 2 ? { who: nameOf(A.warlock.who), links: A.warlock.links.map(nameOf), chain: warlockChain.map(nameOf) } : null,
    quack: quackP ? { who: nameOf(quackP.id), saves: quackSaves.map(nameOf), poisons: quackPoisons.map(nameOf) } : null,
    deaths: uniqueDeaths.map((d) => nameOf(d.playerId)).filter(Boolean),
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
    const aliveBad = w.players.some((p) => TURN_ORDER.includes(p.role) && p.alive);
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
  // 区分存活与已死的狼人：已死者早已亮牌伏法，不能再说『仍然潜伏』
  const aliveWolves = w.players.filter((p) => p.role === 'wolf' && p.alive).map((p) => p.name);
  const deadWolves = w.players.filter((p) => p.role === 'wolf' && !p.alive).map((p) => p.name);
  const wolfNames = w.players.filter((p) => p.role === 'wolf').map((p) => p.name).join('、');
  if (w.phase === 'win') {
    return `所有狼人已被处刑——${wolfNames}。村庄恢复宁静，好人阵营获胜！${buildNightReview(w)}`;
  }
  if (lastExiled) {
    const camp = campOf(lastExiled.role);
    let distinct;
    if (camp === 'neutral') distinct = '那是一位中立者——中立者也会伪装身份、混淆视听';
    else if (camp === 'evil') distinct = '那是坏人阵营的一员（狼人的同伙），虽非狼人但也可在狼死后接手变狼';
    else distinct = '那就是好人中的一员';
    return (
      `「${lastExiled.name}」被处刑，身份公开：【${ROLES[lastExiled.role]}】——可惜，那不是狼人，${distinct}。\n\n` +
      `好人阵营的力量已经耗尽，狼人阵营获胜。潜伏的狼人：「${aliveWolves.join('、')}」${deadWolves.length ? `（另有已伏法的狼人：${deadWolves.join('、')}）` : ''}。${buildNightReview(w)}`
    );
  }
  return `好人阵营已经失去了反击的力量，狼人「${wolfNames}」潜伏在村庄中。狼人获胜。${buildNightReview(w)}`;
}

/**
 * 伪装素材（新角色身份）：为伪装成观者/邮差/庸医/行者/间谍/术士/小丑的坏人/中立
 * 生成确定性的单目标编造话术，杜绝 LLM 自由发挥虚构多重技能。
 * 旧身份（村民/侦探/守卫/法医）的话术在调用处原样保留，七人局不受影响。
 */
function buildCoverMaterial(w, p, declared) {
  // 目标随机选择（避免每夜固定同一人导致发言重复）；带记忆沿用已编造目标，保证多夜说法一致
  if (!p.fakeIntel) p.fakeIntel = {};
  const candidates = alivePlayers(w).filter((x) => x.id !== p.id);
  const remembered = Object.keys(p.fakeIntel).filter((n) => candidates.some((c) => c.name === n));
  let fakeName;
  if (remembered.length && Math.random() < 0.6) {
    fakeName = remembered[Math.floor(Math.random() * remembered.length)]; // 60% 沿用旧目标（说法一致）
  } else {
    fakeName = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)].name : '某人';
  }
  // 阵营编造 + 一致性记忆：同一目标沿用首次编造的阵营，绝不使用真实阵营，也避免多夜自相矛盾
  let fakeCamp = p.fakeIntel[fakeName];
  if (!fakeCamp) {
    const CAMPS = ['好人', '中立', '坏人'];
    fakeCamp = CAMPS[Math.floor(Math.random() * CAMPS.length)];
    p.fakeIntel[fakeName] = fakeCamp;
  }
  switch (declared) {
    case 'watcher':
      return `如「我昨夜观测了${fakeName}的气运，其阵营是${fakeCamp}」（观者每夜只能观测一人，只能编造这一条观测结果，严禁声称观测多人）。`;
    case 'postman':
      return `如「我昨夜给${fakeName}送了一封信，一路平安」（邮差每夜只能送一人，只能编造这一条送信经历）。`;
    case 'quack':
      return `如「我昨夜在家中给来访的${fakeName}递了一碗药，无事发生」（庸医不出门，只能编造给一位来客给药的经历）。`;
    case 'walker':
      return `如「我昨夜拜访了${fakeName}，探明其身份，暂不公布」（行者每夜只能拜访一人，只能编造这一条拜访结果）。`;
    case 'spy':
      return `如「我昨夜拜访了${fakeName}，探得其阵营是${fakeCamp}」（间谍每夜只能拜访一人，只能编造这一条拜访结果）。`;
    case 'warlock':
      return `如「我昨夜在家中作法，链接了两人的命运，暂不公布对象」（术士不出门，只能编造这一条链接陈述，严禁说出具体对象——那会与真实链接重合暴露）。`;
    case 'clown':
      return `如「我昨夜出门走了一圈，没有特别的发现」（小丑绝不能声称扭曲了谁的记忆——那是自曝）。`;
    case 'gambler':
      return `如「我昨夜猜了${fakeName}的阵营，结果是${fakeCamp}」（赌徒每夜只能猜一人，只能编造这一条猜测结果，严禁声称猜了多人）。`;
    case 'thief':
      return `如「我昨夜出门转了转，没有特别的发现」（小偷绝不能声称清除/复制了谁的记忆——那是自曝）。`;
    case 'clerk': {
      // 伪装文员：名单必须包含文员本身（与自称身份一致），否则名单里没有自己声称的身份=自曝
      const pool = [...new Set([...w.rolePoolName, '文员'])];
      // 措辞按轮次适配：首轮说『首轮公布』，后续轮次说『再次公布核对』——避免第 4 天还说『首轮』的时间错位
      const timing = w.round === 1 ? '首轮应当公布名单' : '再次公布名单，供大家核对';
      return `公布本局角色名册：${pool.join('、')}（你只知道名单，不知道谁对应谁；${timing}）。`;
    }
    case 'guard':
      return `如「我昨夜守护了${fakeName}，整夜平安无事」（守卫每夜只能守护一人，只能编造这一条守护经历）。`;
    case 'detective': {
      // 线索随机二选一（曾外出/没外出）+ 一致性记忆：同一目标沿用首次编造的线索，避免多夜说法矛盾
      if (!p.fakeIntel) p.fakeIntel = {};
      let fakeOut = p.fakeIntel[`探_${fakeName}`];
      if (!fakeOut) {
        fakeOut = Math.random() < 0.5 ? '曾外出活动' : '没有外出活动';
        p.fakeIntel[`探_${fakeName}`] = fakeOut;
      }
      return `如「我昨夜暗中探访了${fakeName}，他${fakeOut}」（侦探每夜只能探访一人，只能编造这一条线索）。`;
    }
    case 'forensics': {
      // 第 2 夜起法医必然能验上一案发现场死者：伪装话术必须随轮次适配，否则与公开事实直接冲突（一眼识破）
      // 注意：只能验【上一夜】的死者——当夜（本轮）死者天亮才被发现，法医夜里不可能验到，必须排除
      if (w.round >= 2) {
        const prevDead = [...(w.deaths || [])].reverse().find((d) => d.cause === 'night' && d.round < w.round);
        if (prevDead) {
          // 编造身份一致性记忆：同一死者沿用首次编造的身份，避免多夜说法矛盾
          if (!p.fakeIntel) p.fakeIntel = {};
          let fakeRole = p.fakeIntel[`验_${prevDead.name}`];
          if (!fakeRole) {
            // 纯瞎猜：从完整角色名单随机抽取，不做任何排除——伪装者没有法医能力，就是随便猜
            const pool = w.rolePoolName || [];
            fakeRole = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '村民';
            p.fakeIntel[`验_${prevDead.name}`] = fakeRole;
          }
          return `如「昨夜我前往案发现场，验明了死者${prevDead.name}的真实身份是${fakeRole}」（编造的身份，切勿与已公开信息矛盾；示例句内不得使用引号）。`;
        }
      }
      return `如「昨夜没有可供检验的新尸体」（法医只能检验上一案发现场的死者，首夜无尸体可验）。`;
    }
    case 'villager':
      return `如「我昨夜整夜在家，无人来访」（村民不出门无技能）。`;
    default:
      return `如「我昨夜大多待在家里，没有特别的发现」（与你声称身份一致的日常陈述）。`;
  }
}

/** 处决评价：按目标真实阵营给出准确说辞（单处决/双处决共用） */
function executeVerdict(target) {
  if (target.role === 'wolf') return '这正是狼人，你的判断精准无误。';
  const camp = campOf(target.role);
  if (camp === 'neutral') {
    return '那是一位中立者——中立者也会伪装身份、混淆视听，处刑虽未伤及好人，但也未能揪出狼人。';
  }
  if (camp === 'evil') {
    return '那是坏人阵营的狼人同伙。处刑他也算削弱了坏人阵营，但你没有揪出真正的狼人。';
  }
  return '你误伤了一位好人。好人阵营再少一员。';
}

function buildAdjudicateNarrative(w, target, isPass) {
  if (isPass) {
    return `你权衡再三，决定【放弃处刑】——证据还不够充分，贸然出手可能误伤好人。\n\n今天没有人被放逐，直接进入下一夜。`;
  }
  const roleText = ROLES[target.role];
  const verdict = executeVerdict(target);
  return (
    `你举起法槌，指向「${target.name}」，下令处刑。\n\n` +
    `「${target.name}」被带下去，身份牌翻开——【${roleText}】！${verdict}`
  );
}

/** 终局「逐夜行动回顾」：复盘每晚各方行动与结果（含执行者） */
function buildNightReview(w) {
  const logs = w.nightLogs || [];
  if (!logs.length) return '';
  const parts = ['\n\n—— 逐夜行动回顾 ——'];
  for (const l of logs) {
    const line = [`【第 ${l.round} 夜】`];
    // 狼方
    if (l.wolf) {
      const wft = l.wolf.who || '狼人';
      line.push(l.wolf.killed ? `${wft}（狼）刀杀「${l.wolf.killed}」` : l.wolf.blocked ? `${wft}（狼）袭击「${l.wolf.target}」但被守卫挡下` : `${wft}（狼）未刀任何人`);
    }
    if (l.accomplice) line.push(`${l.accomplice.who}（帮凶）拜访「${l.accomplice.target}」`);
    // 好人
    if (l.guard) {
      const g = l.guard;
      line.push(g.effective && l.wolf && l.wolf.blocked
        ? `${g.who}（守卫）保护「${g.target}」，成功挡下狼刀`
        : `${g.who}（守卫）守护「${g.target}」，平安无事`);
    }
    if (l.detective) line.push(`${l.detective.who}（侦探）探访「${l.detective.target}」，结论：该人昨夜${l.detective.clue}`);
    if (l.forensics && l.forensics.role) line.push(`${l.forensics.who}（法医）鉴定上一夜死者「${l.forensics.target}」的身份为${l.forensics.role}`);
    else if (l.forensics && !l.forensics.role) line.push(`${l.forensics.who}（法医）此前无新尸体可检`);
    // 中立
    if (l.thief) {
      const t = l.thief;
      const eff = t.effect || '行动未生效';
      line.push(`${t.who}（小偷）拜访「${t.target}」：${eff}`);
    }
    if (l.gambler) {
      const g = l.gambler;
      if (g.forgot) line.push(`${g.who}（赌徒）本欲猜测「${g.target}」但被清除记忆，未能行动`);
      else line.push(`${g.who}（赌徒）猜「${g.target}」为${g.claim}（${g.correct ? '正确' : '错误'}${g.died ? '，赌徒不幸殒命' : '，安然无恙'}）`);
    }
    if (l.drunkard && l.drunkard.affected && l.drunkard.affected.length) {
      line.push(`${l.drunkard.who}（酒鬼）迷醉了${l.drunkard.affected.join('、')}`);
    }
    // 十人进阶局角色
    if (l.watcher) line.push(`${l.watcher.who}（观者）观测「${l.watcher.target}」，阵营为${l.watcher.camp}`);
    if (l.postman) line.push(l.postman.saved ? `${l.postman.who}（邮差）送信给「${l.postman.target}」时察觉杀机——狼人空刀` : `${l.postman.who}（邮差）给「${l.postman.target}」送信，无事发生`);
    if (l.walker) line.push(l.walker.kill ? `${l.walker.who}（行者）拜访「${l.walker.target}」——对方是坏人，同归于尽` : `${l.walker.who}（行者）拜访「${l.walker.target}」，探明其身份`);
    if (l.spy) line.push(`${l.spy.who}（间谍）拜访「${l.spy.target}」，明日将${l.spy.lie ? '撒谎' : '如实发言'}`);
    if (l.clown) line.push(`${l.clown.who}（小丑）扭曲了「${l.clown.target}」的记忆`);
    if (l.warlock) line.push(`${l.warlock.who}（术士）链接了「${l.warlock.links[0]}」与「${l.warlock.links[1]}」的命运${l.warlock.chain && l.warlock.chain.length ? `，连锁带走了${l.warlock.chain.join('、')}` : ''}`);
    if (l.quack) {
      const q = l.quack;
      if (q.saves && q.saves.length) line.push(`${q.who}（庸医）救下了${q.saves.join('、')}`);
      if (q.poisons && q.poisons.length) line.push(`${q.who}（庸医）的药毒杀了${q.poisons.join('、')}`);
    }
    if (l.forgotten && l.forgotten.length) line.push(`被清除记忆：${l.forgotten.join('、')}`);
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
  } else {
    // 非首轮身份纪律：整局坚持同一声明，杜绝轮间漂移
    if (NEUTRAL_ROLES.includes(p.role) && p.cover) {
      lines.push(`【身份纪律】你之前一直对外声称自己是「${ROLES[p.cover]}」，本轮也必须继续这么声称——绝不可中途改口暴露真实身份「${ROLES[p.role]}」。`);
    } else if (NEUTRAL_ROLES.includes(p.role) && !p.cover) {
      lines.push(`【身份纪律】你之前一直坦白自己是「${ROLES[p.role]}」，本轮继续如实声明，保持一致。`);
    } else if (EVIL_ROLES.includes(p.role)) {
      lines.push(`【身份纪律】你之前一直对外声称自己是「${ROLES[declared]}」，本轮也必须继续这么声称，绝不可改口。`);
    } else {
      lines.push(`【身份纪律】你之前一直声明自己是「${ROLES[p.role]}」，本轮继续如实声明，保持一致。`);
    }
  }

  // 身份冲突引导：若有人自称与你的真实身份相同 → 一方必假，必须当众质疑
  // （真守卫 vs 假守卫 / 真法医 vs 假法医 等；你的真实身份 = declared 的阵营对应真相）
  if (w.round > 1 && (GOOD_ROLES.includes(p.role) || (NEUTRAL_ROLES.includes(p.role) && !p.cover))) {
    const myRoleName = ROLES[p.role];
    // 从身份声称记录（claims）中找自称与你真实身份相同的人（非自己）。
    // 注意：不能用『发言文本包含身份名』判断——文员公布角色名册时也会念到身份名（如「守卫」），
    // 会被误判为自称该身份，进而向真身注入错误的冲突情报（已修复过的实际案例）。
    const rivals = (w.claims || []).filter(
      (c) => c.playerId !== p.id && c.claimed === myRoleName
    );
    if (rivals.length) {
      const rivalNames = rivals.map((c) => `「${c.name}」`).join('、');
      lines.push(`【重要·身份冲突】${rivalNames}在发言中自称是「${myRoleName}」——而你就是真正的${myRoleName}！同一个身份不可能有两人，${rivals.length > 1 ? '这么多' : ''}自称者中【必然全是伪装者】（除你之外）。你必须在发言中当众指出这一冲突，直接质疑${rivals.length > 1 ? '他们' : '他'}一定在撒谎。这是本模式最硬核的推理证据。`);
    } else {
      lines.push(`【身份警惕】记住：你才是真正的${myRoleName}。若之后有人自称是${myRoleName}，你必须立刻当众质疑——同一身份不可能有两人。`);
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
    const partners = w.players.filter((q) => EVIL_ROLES.includes(q.role) && q.role !== 'wolf' && q.alive);
    lines.push(partners.length ? `你的同伙是${partners.map((q) => `「${q.name}」`).join('、')}（阵营坏人，尚未暴露）。【绝不外泄】` : `你的同伙已不在。`);
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
      lines.push(buildCoverMaterial(w, p, declared));
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
      lines.push(buildCoverMaterial(w, p, declared));
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
      lines.push(buildCoverMaterial(w, p, declared));
    }
  }

  if (affected) {
    // 被迷醉/遗忘：技能记忆失效，但【文员的角色名单是越常信息，不受影响】
    if (p.role === 'clerk') {
      lines.push(`你昨夜被${drunk ? '迷醉' : '清除记忆'}，完全不记得昨夜技能相关的细节。但你【仍然清楚】本局存在的角色名单：${w.rolePoolName.join('、')}。`);
      if (w.round === 1) lines.push(`首轮你应照常当众公布该名单。除此之外，昨夜经历一律表示「我不记得」。`);
    } else {
      lines.push(`【本夜状态】你昨夜${drunk ? '被酒鬼迷醉' : '被小偷清除记忆'}——技能无效，且你不记得昨夜发生了什么事。你的发言只能用一句话表达：「我……抱歉，我完全不记得昨夜做了什么。」`);
    }
    return lines;
  }

  // 小丑扭曲：发言由代码确定性生成（buildTwistedSpeech），知识包不再注入扭曲指令——LLM 会把指令原样念出，已实测

  // 中性/其他角色的伪装一致性提示：若声称身份≠真实身份，禁止提及真实中立夜间活动
  if (NEUTRAL_ROLES.includes(p.role) && p.cover && p.cover !== p.role) {
    lines.push(`【伪装纪律】你声称自己是「${ROLES[p.cover]}」。因此【不要】在发言中提及你真实的中立行动线索（如小偷的"清除记忆/复制能力"、赌博猜测过程），只能用与「${ROLES[p.cover]}」身份相符的陈述。`);
    // 伪装行为素材：与坏人伪装同源，保证骨架里有与伪装身份相符的可陈述事实
    lines.push(`【伪装行为·发言用】${buildCoverMaterial(w, p, p.cover)}`);
  }
  // 其余带伪装的坏人（小丑/术士/间谍等，无内联素材）：统一注入伪装行为素材
  if (p.cover && p.cover !== p.role && EVIL_ROLES.includes(p.role) && !['wolf', 'accomplice', 'drunkard'].includes(p.role)) {
    lines.push(`【伪装行为·发言用】${buildCoverMaterial(w, p, p.cover)}`);
  }

  // 技能结果（未被迷醉/遗忘）
  switch (p.role) {
    case 'guard': {
      const t = findPlayer(w, night.guardTarget);
      // 自保场景：守护目标是自己时用「自己」表述，避免发言者用自己名字称呼自己（人称错乱）
      const name = t ? (t.id === p.id ? '自己' : t.name) : '';
      if (night.wolfBlocked && night.guardTarget === night.wolfTarget) {
        const self = t && t.id === p.id;
        const variants = self
          ? [
              `你昨夜守护了自己，成功挡下了狼人的袭击——你活了下来。`,
              `你昨夜守在自己家中，和袭击者搏斗，把他挡了下来。`,
              `你昨夜护住了自己——狼人确实来了，但被你击退。`,
            ]
          : [
              `你昨夜守护了「${name}」，成功挡下了狼人的袭击——他活了下来。`,
              `你昨夜守在「${name}」身边，和袭击者搏斗，把他挡了下来。`,
              `你昨夜护住了「${name}」——狼人确实来了，但被你击退。`,
            ];
        lines.push(`【昨夜经历】${variants[Math.floor(Math.random() * variants.length)]}`);
      } else {
        // 表述限定在守护对象身上：不说「整夜平安/没人挨到刀」这类全局判断——他人被刀是公开死讯，全局平安会与事实矛盾
        const selfGuard = t && t.id === p.id;
        const variants = selfGuard
          ? [
              `你昨夜守在自己家中，整夜没有遭到任何袭击。`,
              `你昨夜自守门户，直到天亮都平安无事。`,
              `你昨夜守着自己，没有任何异常动静。`,
            ]
          : [
              `你昨夜守护了「${name}」，他整夜安然无恙，没有遭到袭击。`,
              `你昨夜在「${name}」住所外守了一夜，他那边没有异常动静。`,
              `你昨夜保护了「${name}」，直到天亮他都平安。`,
            ];
        lines.push(`【昨夜经历】${variants[Math.floor(Math.random() * variants.length)]}`);
      }
      lines.push(`【重要】你整夜只守在「${name}」这一处，只掌握守护目标的情况。你没有走访、没有监视其他人，因此【不得】声称自己「留意到其他某人的动向」或知道他人夜里做了什么——你没看到。若有人质疑你，就如实说明自己只守护了「${name}」。`);
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
        const deadCamp = campOf(night.forensicsDeadRole);
        const campText = deadCamp === 'good' ? '属于好人阵营' : deadCamp === 'neutral' ? '属于中立阵营' : '属于坏人阵营';
        lines.push(`你昨夜前往上一案发现场，验明了死者「${night.forensicsDeadName}」的真实身份——${ROLES[night.forensicsDeadRole]}，${campText}。这是你今天可以公布的铁证。`);
        // 中立/坏人：明确阵营归属，防止把中立污名化为"非好人=坏人"
        if (deadCamp === 'neutral') {
          lines.push(`【注意】赌徒/小偷属于【中立阵营】，与好人、坏人都不站队。你在发言中应明确说"死者是中立阵营"，【不要】暗示"非好人就是坏人"或"需警惕死者立场相近者"。`);
        }
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
        // 村民只知道「有人来过」，绝不能知道来者是谁/是什么身份——那会直接暴露来访者（如小丑）
        lines.push(`昨夜${visitors.length > 1 ? '有几个人先后来访过你' : '有人来访过你'}，天黑看不清来者是谁、是什么身份。除此之外你整夜在家。`);
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
      // 带伪装的小偷：不注入真实技能结果（夜间行踪与专属行为绝不能进入提示词，
      // 否则模型可能复述自曝——与间谍的处理方式一致），只依赖伪装行为素材
      if (p.cover && p.cover !== 'thief') {
        break;
      }
      const t = findPlayer(w, night.thiefTarget);
      const tName = t ? t.name : '';
      if (night.thiefCopiedRole) {
        // 访死者：获取死者「原本要进行的动作」信息（不继承行动能力）——直接给成品句
        const deadRole = night.thiefCopiedRole;
        let info = '';
        if (deadRole === 'guard') {
          const g = findPlayer(w, night.guardTarget);
          info = g ? `守卫原本想要守护「${g.name}」` : '守卫原本没有明确守护目标';
        } else if (deadRole === 'detective') {
          const d = findPlayer(w, night.detectiveTarget);
          info = d
            ? `侦探原本探访了「${d.name}」，线索是${(night.leavers || []).includes(d.id) ? '他昨夜曾外出活动' : '他昨夜没有外出活动'}（以死者生前的探查为准）`
            : '侦探原本准备探访某人';
        } else if (deadRole === 'forensics') {
          info = night.forensicsDeadRole
            ? `法医原本要验的尸体「${night.forensicsDeadName}」，真实身份是${ROLES[night.forensicsDeadRole]}`
            : '法医原本没有可供检验的尸体';
        } else if (deadRole === 'gambler') {
          const g = findPlayer(w, night.gamblerTarget);
          if (night.gamblerForgot) {
            info = '赌徒昨夜被人清除记忆，并没有完成猜测';
          } else if (g) {
            info = `赌徒原本猜测「${g.name}」的阵营是${night.gamblerTargetCamp || '未知'}（${night.gamblerCorrect ? '他猜对了' : '他赌错了，并因此而死'}）。你只需获得这条情报，无需也不应替他重新下注`;
          } else {
            info = '赌徒原本没有进行猜测';
          }
        } else if (deadRole === 'watcher') {
          const wt = findPlayer(w, night.watcherTarget);
          info = wt && night.watcherCamp
            ? `观者原本观测了「${wt.name}」的气运，探得其阵营是${night.watcherCamp}`
            : '观者原本没有观测到合适的目标';
        } else if (deadRole === 'walker') {
          const wk = findPlayer(w, night.walkerTarget);
          info = wk
            ? `行者原本拜访了「${wk.name}」，探明其真实身份是${ROLES[wk.role]}`
            : '行者原本没有拜访到合适的目标';
        } else if (deadRole === 'spy') {
          const sp = findPlayer(w, night.spyTarget);
          info = sp
            ? `间谍原本拜访了「${sp.name}」，探得其属于${CAMP[campOf(sp.role)]}阵营`
            : '间谍原本没有拜访到合适的目标';
        } else if (deadRole === 'postman') {
          const pm = findPlayer(w, night.postmanTarget);
          info = pm
            ? (night.postmanSaved
              ? `邮差原本给「${pm.name}」送信时察觉到杀机——他本夜正是狼人的目标，狼人扑了个空`
              : `邮差原本给「${pm.name}」送了一封信，一路平安`)
            : '邮差原本没有送出信件';
        } else if (deadRole === 'quack') {
          const saves = (night.quackSaves || []).map((id) => { const q = findPlayer(w, id); return q ? q.name : ''; }).filter(Boolean);
          const poisons = (night.quackPoisons || []).map((id) => { const q = findPlayer(w, id); return q ? q.name : ''; }).filter(Boolean);
          info = saves.length || poisons.length
            ? `庸医原本给来客递了药${saves.length ? `，救下了${saves.join('、')}` : ''}${poisons.length ? `${saves.length ? '，' : ''}药死了${poisons.join('、')}` : ''}`
            : '庸医昨夜原本无人来访';
        } else if (deadRole === 'warlock') {
          const links = (night.warlockLinks || []).map((id) => { const q = findPlayer(w, id); return q ? q.name : ''; }).filter(Boolean);
          info = links.length === 2
            ? `术士原本作法链接了「${links[0]}」与「${links[1]}」的命运`
            : '术士原本没有完成链接';
        } else if (deadRole === 'clown') {
          const cl = findPlayer(w, night.clownTarget);
          info = cl
            ? `小丑原本扭曲了「${cl.name}」的记忆`
            : '小丑原本没有找到合适的目标';
        } else {
          info = '他昨夜只是寻常度日，没有特别的行动';
        }
        // 成品句式：小偷以「从死者处得知」陈述，绝不露「我去拜访了X」（那是夜间行踪自曝）
        lines.push(`你昨夜从死者「${tName}」身上得知了他的秘密：${info}。`);
        lines.push(`【发言纪律】你可以把这条信息当作"自己发现/听闻"的线索说出来，但【绝不能】承认自己夜间拜访过死者——那会暴露你是小偷。`);
      } else if (night.wolfForgot) {
        // 不提拜访对象（夜间行踪自曝）、不用内部术语：扑空的自然表述，进入骨架也安全
        lines.push(`你昨夜出门办了点自己的事，但似乎扑了个空，什么也没做成。`);
      } else if (tName) {
        lines.push(`你昨夜造访了「${tName}」，并清除了他本夜的记忆（他的技能失效了）。`);
        lines.push(`【伪装纪律】若你声称是别的身份，别说出"我清除了X记忆"这种小偷专属行为——那会暴露你。可以用"X昨夜行为反常/失忆"侧面表达。`);
      }
      break;
    }
    case 'accomplice': {
      const wolf = w.players.find((q) => q.role === 'wolf' && q.alive);
      lines.push(wolf ? `你清楚狼人是「${wolf.name}」。你可以为他掩护或转移注意力。` : `狼人已死，你随时可能接手狼人之位。`);
      break;
    }
    // —— 十人进阶局角色 ——
    case 'watcher': {
      const t = findPlayer(w, night.watcherTarget);
      if (t && night.watcherCamp) {
        lines.push(`你昨夜在家中观测了「${t.name}」的气运，得知其阵营是【${night.watcherCamp}】——但你无法得知其具体身份。这是你今天可以公布的信息。`);
      } else {
        lines.push(`你昨夜没有观测到合适的目标。`);
      }
      break;
    }
    case 'postman': {
      const t = findPlayer(w, night.postmanTarget);
      if (night.postmanSaved) {
        lines.push(`你昨夜给「${t ? t.name : ''}」送信时察觉到浓重杀机——你本夜正是狼人的目标！但你的信件让狼人扑了个空，狼人空刀而归。你活了下来，并且【确切知道】自己昨夜是狼人的刀下目标。这是你今天可以公布的重大信息。`);
      } else if (t) {
        lines.push(`你昨夜给「${t.name}」送了一封信，一路平安，无事发生。`);
      } else {
        lines.push(`你昨夜没有送出信件。`);
      }
      break;
    }
    case 'walker': {
      const t = findPlayer(w, night.walkerTarget);
      if (t && !EVIL_ROLES.includes(t.role)) {
        lines.push(`你昨夜拜访了「${t.name}」，探明了他的真实身份——【${ROLES[t.role]}】。这是你今天可以公布的信息（公布与否由你判断利弊）。`);
      } else {
        lines.push(`你昨夜没有拜访到合适的目标。`);
      }
      break;
    }
    case 'spy': {
      // 间谍抽到伪装身份时：不注入真实拜访结果（公布间谍技能=声称伪装身份没有的能力=自曝），
      // 改为按伪装身份编造陈述（与伪装纪律一致）；只有坦白身份的间谍才公布真实结果与撒谎指令。
      if (p.cover && p.cover !== 'spy') {
        const coverName = ROLES[p.cover];
        lines.push(`【伪装行为·发言用】你声称自己是「${coverName}」。据此编造与该身份一致的夜间行为陈述，【不要】提及任何拜访/探查阵营的行为——那不是「${coverName}」的能力，说了等于自曝。`);
        break;
      }
      const t = findPlayer(w, night.spyTarget);
      if (t) {
        const camp = campOf(t.role);
        const campText = CAMP[camp];
        if (night.spyLie) {
          const fakeCamp = camp === 'evil' ? '好人' : '坏人';
          // 可公布的说法（含谎报阵营）单独成行——骨架只提取这行，指令行绝不进入发言
          lines.push(`【昨夜经历】你昨夜拜访了「${t.name}」，探得他属于${fakeCamp}阵营。`);
          lines.push(`【本日指令·仅你知晓】你今日必须撒谎：公布拜访结果时，把「${t.name}」的阵营谎报为${fakeCamp}（上面那行已是你要公布的说法）。若有人掌握相反的铁证，你将陷入被动。`);
        } else {
          lines.push(`你昨夜拜访了「${t.name}」，探得他属于【${campText}】阵营。你今日如实公布这一结果即可。`);
        }
      } else {
        lines.push(`你昨夜没有拜访到合适的目标。`);
      }
      break;
    }
    case 'quack': {
      const visitors = (night.quackVisitors || []).map((id) => { const q = findPlayer(w, id); return q ? q.name : ''; }).filter(Boolean);
      if (visitors.length) {
        lines.push(`你昨夜在家中接待了访客：${visitors.join('、')}。你给每位来客都递了一碗药。`);
        if ((night.quackSaves || []).length) lines.push(`其中有人本夜将遭不测，被你的药从鬼门关拉了回来。`);
        if ((night.quackPoisons || []).length) lines.push(`也有人体质不合，服下药后毒发身亡——这是意外，你行医只为自保。`);
      } else {
        lines.push(`你昨夜整夜在家，无人来访。`);
      }
      break;
    }
    case 'clown': {
      const wolf = w.players.find((q) => q.role === 'wolf' && q.alive);
      const t = findPlayer(w, night.clownTarget);
      lines.push(wolf ? `你清楚狼人是「${wolf.name}」。你可以为他掩护或转移注意力。` : `狼人已死，你随时可能接手狼人之位。`);
      if (t) lines.push(`你昨夜扭曲了「${t.name}」的记忆——他今日的发言会颠倒关键信息，为你们制造混乱。【绝不外泄】这是你的真实行动。`);
      break;
    }
    case 'warlock': {
      const wolf = w.players.find((q) => q.role === 'wolf' && q.alive);
      lines.push(wolf ? `你清楚狼人是「${wolf.name}」。你可以为他掩护或转移注意力。` : `狼人已死，你随时可能接手狼人之位。`);
      if ((night.warlockLinks || []).length === 2) {
        const names = night.warlockLinks.map((id) => { const q = findPlayer(w, id); return q ? q.name : ''; }).filter(Boolean);
        lines.push(`你昨夜在家中作法，链接了「${names[0]}」与「${names[1]}」的命运——两人中若有一人今夜死亡，另一人也活不成。【绝不外泄】这是你的真实行动。`);
        if ((night.warlockChain || []).length) lines.push(`你的链接已经生效，带走了额外的牺牲者。`);
      }
      break;
    }
  }
  return lines;
}

// ==================== 结构化发言：事实骨架 + 措辞润色 + 输出校验 ====================
// 各角色官方技能一句话说明：注入提示词供 AI 理解背景（发言中不得复述），从源头杜绝规则幻觉
const ROLE_SKILL_DESC = {
  clerk: '文员不出门，开局掌握本局角色名单并公布，无夜晚技能',
  detective: '侦探每夜探访一人，获知其「曾外出活动/没有外出活动」',
  villager: '村民不出门无技能，有人拜访会知道「有人来过」',
  forensics: '法医第一夜不出门，此后每夜前往上一案发现场，白天公布死者真实身份',
  guard: '守卫每夜保护一人（可自保、不可连续两夜同一人），可挡下狼刀',
  gambler: '赌徒每夜猜一人阵营，猜对获知其阵营，猜错立即死亡',
  thief: '小偷每夜拜访一人清除其记忆，拜访死者可复制其信息',
  wolf: '狼人每夜刀杀一人',
  accomplice: '帮凶每夜拜访一人干扰调查，不刀人',
  drunkard: '酒鬼不出门，夜里拜访他的人会被迷醉',
  watcher: '观者每夜观测一人阵营（观测不构成拜访）',
  postman: '邮差每夜送信给一人，若狼人目标与其重合则狼人空刀',
  walker: '行者每夜拜访一人探明身份，对方是坏人则同归于尽',
  quack: '庸医每夜给药，药可救被刀者或毒杀人',
  spy: '间谍每夜拜访一人探其阵营，次日如实或撒谎公布',
  clown: '小丑每夜扭曲一人记忆，使其坚信错误信息',
  warlock: '术士每夜链接两人命运，一人死则另一人也死',
};

/**
 * 事实骨架：从知识包提取本轮必须交代的事实行（程序确定性生成）。
 * LLM 只负责把骨架润色为自然发言，不得增删事实——这是结构化发言的核心。
 */
function buildSpeechSkeleton(game, speaker) {
  const k = buildRoleKnowledge(game, speaker);
  const facts = [`我是${ROLES[speaker.cover || speaker.role]}`];
  // 带伪装（伪装≠真实身份）时，真实身份的技能结果行绝不能进入骨架——那是行为泄露
  const disguised = speaker.cover && speaker.cover !== speaker.role;
  for (const line of k) {
    // 跳过纪律/指令/内部情报类行（真实夜间行动与撒谎指令绝不进入骨架）
    if (/^【(首轮规则|身份纪律|重要|身份警惕|内部情报|本夜状态|本日指令|伪装纪律)/.test(line)) continue;
    if (/必须撒谎|谎报|仅你知晓/.test(line)) continue;
    // 伪装者：跳过真实身份的技能结果行（【昨夜经历】等），只保留【伪装行为】素材
    // 词表含『造访』——小偷知识行用『造访』表述，漏拦会导致夜间行踪与专属行为自曝
    if (disguised && !/^【伪装行为/.test(line) && /昨夜|线索|观测|守护|保护|探访|拜访|造访|送信|给药|查验|猜测|有人来|前往|清除|记忆/.test(line)) continue;
    // 小偷（即使坦白身份）：清除记忆的具体对象绝不进入骨架——公开夜间行动等于替法官解谜，用模糊表述代替
    if (speaker.role === 'thief' && /清除|记忆|复制/.test(line) && !/^【伪装行为/.test(line)) {
      facts.push('昨夜我出门办了点自己的事，细节不便多说。');
      continue;
    }
    // 示例句（如「我昨夜…」）：直接提取引号内内容作为事实
    const demo = line.match(/如「([^」]+)」/);
    if (demo) {
      facts.push(demo[1]);
      continue;
    }
    if (/昨夜|线索|观测|守护|保护|探访|拜访|送信|给药|查验|猜测|名册|有人来|掌握|前往|不记得/.test(line)) {
      // 去掉括号说明与「注意：」开头的规则解释子句，只保留可陈述事实
      const fact = line
        .replace(/^【[^】]*】/, '')
        .replace(/【([^】]*)】/g, '$1')
        .replace(/（[^）]*）/g, '')
        .replace(/注意[：:][^。]*。?/g, '')
        .replace(/你的/g, '我的')
        .replace(/你/g, '我');
      if (fact.replace(/[【】]/g, '').trim().length > 4) facts.push(fact);
    }
  }
  return facts;
}

/**
 * 结构化输出校验（硬兜底）：
 * 1) 引号内名称必须在「本局玩家名 / 角色名 / 阵营名」白名单内；
 * 2) 规则断言词（中毒/自毙/误验等）必须来自骨架——骨架没有即为编造规则。
 * 校验失败由调用方回退到确定性兜底发言。
 */
function validateSpeechFacts(game, speaker, speech) {
  const w = game.deduction;
  const text = String(speech || '');
  const nameSet = new Set(w.players.map((p) => p.name));
  const roleNames = Object.values(ROLES);
  const quoted = text.match(/[「“]([^」”]{1,8})[」”]/g) || [];
  for (const q of quoted) {
    const inner = q.slice(1, -1);
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(inner) && !nameSet.has(inner) && !roleNames.includes(inner) && !['好人', '中立', '坏人'].includes(inner)) {
      return `未知名称「${inner}」`;
    }
  }
  const RULE_WORDS = /(中毒|自毙|毒死|误验|验错|同归于尽|连锁|空刀|立即死|就会死|会死亡|住所内行凶|不代表[^。]{0,6}安全|不等于[^。]{0,6}安全|在家动手|在家行凶|颠倒关键信息|扭曲[^。]{0,4}记忆|被扭曲)/;
  if (RULE_WORDS.test(text)) {
    const skeletonText = buildSpeechSkeleton(game, speaker).join('');
    if (!RULE_WORDS.test(skeletonText)) return '编造规则机制';
  }
  // 虚构他人声明校验：发言中「X自称Y / X跳Y」的引用必须与实际身份声明记录（claims）一致
  const claimRef = text.match(/([\u4e00-\u9fa5]{2,3})(自称|跳了?|也说是|说是)(文员|侦探|村民|法医|守卫|赌徒|小偷|狼人|帮凶|酒鬼|观者|邮差|行者|庸医|间谍|小丑|术士)/g) || [];
  for (const ref of claimRef) {
    const m = ref.match(/([\u4e00-\u9fa5]{2,3})(?:自称|跳了?|也说是|说是)(文员|侦探|村民|法医|守卫|赌徒|小偷|狼人|帮凶|酒鬼|观者|邮差|行者|庸医|间谍|小丑|术士)/);
    if (!m) continue;
    const [, refName, refRole] = m;
    const target = w.players.find((p) => p.name === refName);
    if (!target) continue;
    const actual = (w.claims || []).find((c) => c.playerId === target.id);
    if (!actual || actual.claimed !== refRole) return `虚构${refName}的声明`;
  }
  return '';
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
  // 结构化发言核心：事实骨架（程序确定性生成）+ 官方技能说明（背景理解用，不得复述）
  const skeleton = buildSpeechSkeleton(game, speaker);
  const skillDesc = ROLE_SKILL_DESC[speaker.role] || '';

  const factLine =
    `【发言方式 — 最高原则：只润色骨架，不得增删事实】\n` +
    `0. 【事实骨架】你的发言必须且只需覆盖以下事实点（顺序可调、措辞可改写，但一个都不能丢、一个都不能加）：\n${skeleton.map((f, i) => `   ${i + 1}. ${f}`).join('\n')}\n` +
    `1. 你的任务是把骨架改写成自然、口语化的第一人称发言（2~3 句话、40~90 字），可以调整语序、补充语气词，但【不得添加任何骨架之外的事实、人名、线索或规则】。\n` +
    `2. 【规则铁律】不得解释、引用或编造任何游戏规则与技能机制（如「X被验会死」「X中毒自毙」）。规则性内容只允许出现在骨架里；骨架没有的规则一个字都不能提。\n` +
    `3. 【背景参考·不得复述】各角色真实技能（仅供你理解他人发言，绝不在发言中复述）：${skillDesc}。\n` +
    `4. 杜绝废话：不寒暄、不喊口号、不重复他人已说的话。用陈述句。\n` +
    `5. 【生死状态·铁律】严格区分存活者与死者：死者已出局，绝不能说存活者「已死/被袭击身亡/不在了」；也绝不能把死者当作仍在场的人讨论或向其发问。发言前先对照下方的存活名单与死者名单。\n` +
    `6. 【人称纪律·铁律】你始终用第一人称「我」称呼自己，绝不用自己的名字称呼自己；提及他人用其名字。\n` +
    `7. 【回应边界·铁律】你只能陈述骨架中的事实。不得自行添加对他人发言的回应、否认或评价（如「我不认」「他说的不对」）——你无法验证他人说法的真伪，除非骨架中明确提供了与之冲突的信息（如身份对跳），否则不要对他人的陈述表态。`;

  return {
    system: [
      `你是狼人杀类游戏「推理杀」中的玩家「${speaker.name}」，正在参加一局 ${w.players.length} 人局。法官正在旁观并会裁决。`,
      knowledge,
      factLine,
      `存活玩家（仅这些人还在场）：${aliveList}。`,
      w.deaths.length
        ? `已死亡玩家（已出局，不可作为在场者讨论）：${w.deaths.map((x) => `${x.name}（第${x.round}天${x.cause === 'night' ? '夜间遇害' : '被处刑'}）`).join('、')}。`
        : '目前无人死亡。',
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
  const text = String(speech || '');
  // 身份词；守卫/小偷等亦可能是动词，用负向前瞻排除"守卫了/守卫过/保护了"等用法
  const ROLE_RE = '(文员|侦探|村民|法医|守卫(?!了|过|在)|赌徒|小偷|狼人|帮凶|酒鬼|观者|邮差|行者|庸医|间谍|小丑|术士)';
  // 1) "我是身份"（紧贴）
  const direct = text.match(new RegExp(`我是${ROLE_RE}`));
  if (direct) return direct[1];
  // 2) "我是名字，身份"/"我是名字，我是身份"/"我是名字身份"（名字≤8字，含逗号）
  const withName = text.match(new RegExp(`我是[^。！]{0,8}?${ROLE_RE}`));
  if (withName && withName[0].indexOf('，') > 2) return withName[1];
  if (withName) return withName[1];
  // 3) "我的身份是X" / "身份是X"
  const viaIdentity = text.match(new RegExp(`身份[^。；，,]{0,4}?${ROLE_RE}`));
  if (viaIdentity) return viaIdentity[1];
  return '';
}

/**
 * LLM 发言失败时的兜底发言（保证不与自称矛盾、不做无谓"斟酌"）。
 * 基于角色知识包生成真实、克制的陈述句；坏人只用安全话术，不泄露身份。
 */
function fallbackSpeech(game, speaker) {
  const w = game.deduction;
  const night = w.night || {};
  const declared = ROLES[speaker.cover || speaker.role];
  const part = [`我是${declared}。`];

  if (speaker.role === 'gambler' && !speaker.cover) {
    // 赌徒兜底：直接读 night 组装完整猜测结果（真赌徒拥有硬信息）；带伪装时走下方伪装分支，绝不泄露查验行为
    const t = findPlayer(w, night.gamblerTarget);
    if (night.gamblerForgot) {
      part.push(`昨夜我被人清除了记忆，没能完成猜测。`);
    } else if (t) {
      const camp = night.gamblerTargetCamp || '未知';
      const got = night.gamblerCorrect ? `我探明了他，他是${camp}阵营的。` : `可惜我赌错了，没得到有用信息。`;
      part.push(`昨夜我暗中查验了「${t.name}」的阵营，${got}`);
    } else {
      part.push(`昨夜我没有找到合适的查验对象。`);
    }
  } else if (speaker.role === 'thief' && !speaker.cover) {
    // 小偷兜底：从 night 直接组装"得知死者的秘密"信息；避免泄漏行踪。带伪装时走下方伪装分支
    const t = findPlayer(w, night.thiefTarget);
    if (night.thiefCopiedRole && t && !t.alive) {
      part.push(`我从死者那边了解到一些情况，但目前还想再核实一下。`);
    } else if (night.thiefTarget && !night.thiefCopiedRole) {
      part.push(`昨夜我这边有些情况值得留意，先不多说。`);
    } else {
      part.push('昨夜没有特别的发现。');
    }
  } else if (EVIL_ROLES.includes(speaker.role)) {
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
      // 法医兜底复用伪装素材（第 2 夜起自动适配为编造验尸结果）
      const mat = buildCoverMaterial(w, speaker, 'forensics');
      const demo = mat.match(/如「([^」]+)」/);
      part.push(demo ? demo[1] : '昨夜没有可供检验的尸体。');
    } else if (cover === 'clerk') {
      // 文员兜底：与首轮声明一致（文员不出门无夜间行动），不制造前后矛盾
      part.push('昨夜我在家整理角色名册档案，没有夜间行动。');
    } else {
      // 其余伪装身份：从伪装素材提取示例句——夜间主动型角色（间谍/行者/邮差等）绝不能说「整夜在家」（与声称身份矛盾）
      const mat = buildCoverMaterial(w, speaker, cover);
      const demo = mat.match(/如「([^」]+)」/);
      part.push(demo ? demo[1] : '昨夜我有些自己的安排，暂不多说。');
    }
  } else {
    // 好人/带伪装中立兜底：从知识包提取事件行；清洗【】标记、括号说明与规则解释子句，避免照抄素材
    // 带伪装者（伪装≠真实身份）只提取【伪装行为】素材行，真实技能结果绝不进入兜底发言
    const disguisedFallback = speaker.cover && speaker.cover !== speaker.role;
    const k = buildRoleKnowledge(game, speaker);
    for (const line of k) {
      if (disguisedFallback && !/^【伪装行为/.test(line)) continue;
      // 伪装素材行：只提取引号内示例句，绝不整行输出（含括号说明的原文等于自曝素材）
      if (/^【伪装行为/.test(line)) {
        const demo = line.match(/如「([^」]+)」/) || line.match(/「([^」]{8,})」/);
        if (demo) part.push(demo[1]);
        continue;
      }
      if (/昨夜|昨夜我/.test(line) || /有人来/.test(line) || /掌握|名册/.test(line) || /我前往/.test(line)) {
        const cleaned = line
          .replace(/^【[^】]*】/, '')
          .replace(/【([^】]*)】/g, '$1')
          .replace(/（[^）]*）/g, '')
          .replace(/注意[：:][^。]*。?/g, '')
          .replace(/你的/g, '我的')
          .replace(/你/g, '我');
        if (cleaned.trim().length > 4) part.push(cleaned);
      }
    }
  }

  // 长度保险：若兜底仍过短，补充一句通用推理/表态句，保证信息量
  // 片段拼接前统一补句尾标点，避免两句粘连（如『新尸体目前我暂时』）
  const parts = part.slice(0, 2).map((s) => (/[。！？…]$/.test(s.trim()) ? s : s.trim() + '。'));
  let out = parts.join('').slice(0, MAX_SPEECH);
  if (out.length < 20 && alivePlayers(w).length > 1) {
    const other = alivePlayers(w).find((p) => p.id !== speaker.id);
    out += (other ? `目前我暂时没有更多实据，需要结合大家的发言推断。` : `目前我暂时没有更多实据，先听听大家的判断。`);
  }
  out = out.slice(0, MAX_SPEECH);
  // 兜底输出同样做引号闭合与句尾处理：截断切在引号内部时回退到最后一个完整句号
  const oq = (out.match(/「/g) || []).length;
  const cq = (out.match(/」/g) || []).length;
  if (oq !== cq) {
    const lastStop = Math.max(out.lastIndexOf('。'), out.lastIndexOf('！'), out.lastIndexOf('？'));
    if (lastStop > 10) out = out.slice(0, lastStop + 1);
    else out = out.replace(/[「」]/g, '');
  }
  if (out.length > 10 && !/[。！？…]$/.test(out)) out += '。';
  return out;
}

/**
 * 小丑扭曲·确定性说反发言（不经 LLM）：
 * LLM 靠指令撒谎不可靠（实测会把扭曲指令原样念出），改为代码级反转——
 * 从被扭曲者的真实知识包提取技能结果行，把关键结论反转（在家↔外出、平安↔异常、阵营对调），
 * 身份声明保持不变，被扭曲者坚信自己说的是真的。
 */
function buildTwistedSpeech(game, speaker) {
  const declared = ROLES[speaker.cover || speaker.role];
  const k = buildRoleKnowledge(game, speaker);
  let line = '';
  for (const l of k) {
    // 排除素材/指令类行（伪装行为、发言用等）——扭曲发言只能反转真实经历行，绝不能念出素材原文
    if (/昨夜|线索|观测|守护|保护|探访|拜访|送信|给药|查验|猜测/.test(l) && !/身份|纪律|指令|铁律|重要|警惕|绝不|禁止|名册|同伙|注意|掌握|伪装行为|发言用|如「/.test(l)) {
      line = l;
      break;
    }
  }
  if (!line) {
    return `我是${declared}。昨夜我总觉得有些异常动静，但说不清具体是什么，心里很不踏实。`;
  }
  let t = line.replace(/你的/g, '我的').replace(/你/g, '我');
  // 清洗知识行标记（【昨夜经历】等），扭曲发言同样不得照抄标记
  t = t.replace(/^【[^】]*】/, '').replace(/【([^】]*)】/g, '$1');
  t = t
    .replace(/没有外出活动（一直待在住所）|没有外出活动/g, '【占位外出】')
    .replace(/曾外出活动/g, '【占位在家】')
    .replace(/【占位外出】/g, '曾外出活动')
    .replace(/【占位在家】/g, '没有外出活动（一直待在住所）');
  t = t
    .replace(/一路平安|平安无事|风平浪静|无事发生|没有异常动静|整夜平稳/g, '【占位平安】')
    .replace(/【占位平安】/g, '有些异常动静');
  t = t
    .replace(/好人/g, '【占位好】')
    .replace(/坏人/g, '【占位坏】')
    .replace(/中立/g, '【占位中】')
    .replace(/【占位好】/g, '坏人')
    .replace(/【占位坏】/g, '好人')
    .replace(/【占位中】/g, '好人');
  return `我是${declared}。${t}`.slice(0, MAX_SPEECH);
}

/** 生成单个 AI 的发言；失败/被迷醉遗忘时回落模板（保证回合不断） */
async function generateSpeech(game, speaker) {
  const w = game.deduction;
  const built = buildSpeechPrompt(game, speaker);
  if (built.affected) {
    // 文员被遗忘时仍应公布名单（越常信息不受影响），其它角色走"忘记"模板
    const clerkPool = w.rolePoolName.join('、');
    const speech = speaker.role === 'clerk'
      ? `我是文员。本局存在的角色有：${clerkPool}。昨夜我被人${w.night && (w.night.drunkIds || []).includes(speaker.id) ? '迷醉不清' : '清除了记忆'}，具体经过不记得了。`
      : '我……抱歉，我完全不记得昨夜发生了什么。';
    return { speech, suspect: '', affected: true };
  }
  // 小丑扭曲：确定性说反发言（不经 LLM——LLM 会把扭曲指令原样念出，已实测）
  if (w.night && (w.night.twistedIds || []).includes(speaker.id)) {
    return { speech: buildTwistedSpeech(game, speaker), suspect: '' };
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
    let speech = String((obj && obj.speech) || '').trim().slice(0, MAX_SPEECH);
    // 截断保护：被 MAX_SPEECH 截断且无完整句尾时，回退到最后一个完整句号，避免半句话
    if (speech.length >= MAX_SPEECH && !/[。！？]$/.test(speech)) {
      const lastStop = Math.max(speech.lastIndexOf('。'), speech.lastIndexOf('！'), speech.lastIndexOf('？'));
      if (lastStop > 20) speech = speech.slice(0, lastStop + 1);
    }
    // 过短发言（如"我是侦探。"一句话敷衍）直接替换为知识包兜底，确保完整信息
    if (speech.length < 24) {
      console.log('[debug] 推理杀发言过短，用知识包兜底替代:', JSON.stringify(speech.slice(0, 30)));
      speech = fallbackSpeech(game, speaker);
    }
    // 坏人自曝拦截：发言中若出现自己的真实坏人身份（狼人/帮凶/酒鬼），强制兜底为伪装话术
    if (EVIL_ROLES.includes(speaker.role)) {
      const myEvilName = ROLES[speaker.role];
      // 只拦截"我是(真实邪恶身份)"这类自称，不拦截"怀疑X是狼人"这类指认
      const selfReveal = new RegExp(`我是${myEvilName}|我的身份是${myEvilName}|我就是${myEvilName}`);
      if (selfReveal.test(speech)) {
        console.log('[debug] 推理杀坏人自曝身份，兜底为伪装话术:', JSON.stringify(speech.slice(0, 30)));
        speech = fallbackSpeech(game, speaker);
      }
    }
    // 间谍发言校验：坦白间谍公布的阵营必须与素材一致（诚实=真实阵营；撒谎=指定假阵营），
    // 被小丑扭曲的间谍除外（扭曲指令本身要求说反）。不一致时用确定性句子兜底。
    if (speaker.role === 'spy' && !speaker.cover) {
      const night = w.night || {};
      const twisted = (night.twistedIds || []).includes(speaker.id);
      if (!twisted) {
        const t = findPlayer(w, night.spyTarget);
        if (t) {
          const expectCamp = night.spyLie
            ? (campOf(t.role) === 'evil' ? '好人' : '坏人')
            : CAMP[campOf(t.role)];
          if (!speech.includes(t.name) || !speech.includes(expectCamp)) {
            console.log('[debug] 推理杀间谍发言与素材矛盾，兜底为确定性句子:', JSON.stringify(speech.slice(0, 30)));
            speech = `我是间谍。昨夜我拜访了「${t.name}」，探得他属于${expectCamp}阵营。`;
          }
        }
      }
    }
    // 伪装一致性拦截：坏人/中立带伪装时，自称身份必须与伪装身份一致（LLM 偏离伪装 → 兜底）
    if ((EVIL_ROLES.includes(speaker.role) || NEUTRAL_ROLES.includes(speaker.role)) && speaker.cover) {
      const claimed = extractClaim(speech);
      if (claimed && claimed !== ROLES[speaker.cover]) {
        console.log('[debug] 推理杀自称偏离伪装身份，兜底:', JSON.stringify(speech.slice(0, 30)));
        speech = fallbackSpeech(game, speaker);
      }
    }
    // 人称错乱拦截（扩展）：发言者绝不应提及自己的名字（第一人称纪律）——任何位置出现自己名字即兜底
    if (speaker.name && speech.includes(speaker.name)) {
      console.log('[debug] 推理杀人称错乱（发言中出现自己名字），兜底:', JSON.stringify(speech.slice(0, 30)));
      speech = fallbackSpeech(game, speaker);
    }
    // 伪装村民行为泄露拦截：声称村民却说出出门行为（造访/拜访/送信等）→ 兜底为整夜在家
    if (speaker.cover === 'villager' && /我(昨夜|昨晚)(去|到|造访|拜访|探访|送信|观测)/.test(speech)) {
      console.log('[debug] 推理杀伪装村民泄露出门行为，兜底:', JSON.stringify(speech.slice(0, 30)));
      speech = `我是村民。昨夜我整夜在家，无人来访。`;
    }
    // 真实行为泄露拦截（通用）：带伪装者说出真实身份的专属行为词 → 等于自曝，兜底为伪装话术
    if (speaker.cover && speaker.cover !== speaker.role) {
      const revealWords = {
        thief: /清除.{0,3}记忆|清了.{0,3}记忆|复制了?.{0,6}(动作|信息|技能)/,
        wolf: /我(昨夜|昨晚)?(刀杀|刀了|袭击了|杀了)/,
        clown: /扭曲了?.{0,3}记忆/,
        warlock: /链接了?.{0,4}(命运|两人)/,
        drunkard: /迷醉了/,
      };
      const re = revealWords[speaker.role];
      if (re && re.test(speech)) {
        console.log('[debug] 推理杀伪装者泄露真实身份专属行为，兜底:', JSON.stringify(speech.slice(0, 30)));
        speech = fallbackSpeech(game, speaker);
      }
    }
    // 素材原文泄露拦截：发言中照抄了知识包标记（【】/如「」/发言用）或知识包特征句式（确切知道/重大信息）→ 提取引号内陈述句，提取不到则兜底
    // 程序性表述拦截：『系统提示』等面向开发者的措辞泄露程序视角，绝不能出现在玩家发言中
    if (/【|】|如「|发言用|确切知道|确知|重大信息|系统提示|程序|后台/.test(speech)) {
      const demo = speech.match(/「(我[^」]{6,})」/) || speech.match(/「([^」]{6,})」/);
      speech = demo ? demo[1] : fallbackSpeech(game, speaker);
      if (speech.length > 10 && !/[。！？…]$/.test(speech)) speech += '。';
      console.log('[debug] 推理杀发言照抄素材行，已提取陈述句/兜底');
    }
    // 结构化输出校验（硬兜底）：编造规则机制 / 引用白名单外名称 → 回退确定性兜底发言
    const factErr = validateSpeechFacts(game, speaker, speech);
    if (factErr) {
      console.log('[debug] 推理杀发言未过结构化校验（' + factErr + '），兜底:', JSON.stringify(speech.slice(0, 30)));
      speech = fallbackSpeech(game, speaker);
    }
    if (!speech) throw new Error('empty speech');
    let suspect = String((obj && obj.suspect) || '').trim();
    const named = suspectFromSpeech(w, speaker, speech);
    const target = findPlayer(w, suspect);
    if (named && (!target || target.id !== named)) suspect = named;
    // 法医轮次矛盾拦截：自称法医者在存在上一夜死者时说「没有尸体可验」→ 与规则矛盾，兜底
    const claimedForensics = extractClaim(speech) === '法医';
    if (claimedForensics && w.round >= 2) {
      const prevDead = [...(w.deaths || [])].reverse().find((d) => d.cause === 'night' && d.round < w.round);
      if (prevDead && /没有可供.{0,4}检验.{0,4}尸体|没有.{0,6}尸体可/.test(speech)) {
        console.log('[debug] 推理杀法医无尸体说法与轮次矛盾，兜底:', JSON.stringify(speech.slice(0, 30)));
        speech = fallbackSpeech(game, speaker);
      }
    }
    // 引号闭合校验：发言中「」不成对（截断切在引号内部，句子不完整）→ 兜底
    const openQuotes = (speech.match(/「/g) || []).length;
    const closeQuotes = (speech.match(/」/g) || []).length;
    if (openQuotes !== closeQuotes) {
      console.log('[debug] 推理杀发言引号未闭合（截断），兜底:', JSON.stringify(speech.slice(0, 30)));
      speech = fallbackSpeech(game, speaker);
    }
    // 句尾补全（统一出口）：不以句号结尾的完整发言补句号，覆盖 LLM 与兜底所有路径
    if (speech.length > 10 && !/[。！？…]$/.test(speech)) speech += '。';
    // 句中粘连检测：超过 20 字的无标点连续段（两句被粘连）→ 兜底
    if (/[\u4e00-\u9fa5]{20,}/.test(speech)) {
      console.log('[debug] 推理杀发言句中粘连，兜底:', JSON.stringify(speech.slice(0, 30)));
      speech = fallbackSpeech(game, speaker);
    }
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
    board: w.board || 'standard',
    // 注意：不再直接把完整角色名册交给前端（那是文员的职责/信息价值）。
    players: w.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, isPlayer: false })),
    claims: (w.claims || []).map((c) => ({ playerId: c.playerId, name: c.name, claimed: c.claimed })), // 纯发言提取的自称身份
    deaths: w.deaths.map((d) => ({
      round: d.round,
      name: d.name,
      cause: d.cause, // night（不亮身份） | execute（亮身份）
      role: d.cause === 'execute' ? ROLES[d.role] : '',
    })),
    roles: over
      ? w.players.map((p) => ({
          name: p.name,
          role: ROLES[p.role],
          // 变身者附带原本身份与变身轮次，复盘体现完整身份轨迹
          roleBackup: p.roleBackup ? ROLES[p.roleBackup] : '',
          turnedRound: p.turnedRound || 0,
        }))
      : null,
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
  const board = opts.board === 'advanced' ? 'advanced' : 'standard';
  const w = {
    phase: 'day',
    round: 1,
    board,
    players: assignRoles(board),
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

  // 多目标处决：十人进阶局最多处决两人；七人标准局仍限一人
  const multi = Array.isArray(targetId);
  const maxExec = w.board === 'advanced' ? 2 : 1;
  const ids = (multi ? targetId : [targetId]).map((x) => String(x || '').trim()).filter(Boolean);
  if (ids.length > maxExec) return { ok: false, message: `本局最多同时处决 ${maxExec} 人` };
  if (new Set(ids).size !== ids.length) return { ok: false, message: '处决目标重复，请选择不同的玩家' };

  const isPass = !ids.length;
  const targets = [];
  for (const id of ids) {
    const t = findPlayer(w, id);
    if (!t) return { ok: false, message: '处刑目标不存在，请选择在场玩家' };
    if (!t.alive) return { ok: false, message: `「${t.name}」已经死亡，无法处刑，请选择存活玩家` };
    targets.push(t);
  }
  // 统一落盘（先校验全部目标，再逐个处决，避免部分生效）
  for (const t of targets) {
    t.alive = false;
    w.deaths.push({ round: w.round, playerId: t.id, name: t.name, cause: 'execute', role: t.role, roleBackup: t.role });
  }

  let narrative = targets.length > 1
    ? `你举起法槌，接连指向「${targets.map((t) => t.name).join('」与「')}」，下令处决两人。\n\n${targets.map((t) => `「${t.name}」被带下去，身份牌翻开——【${ROLES[t.role]}】！${executeVerdict(t)}`).join('\n\n')}`
    : buildAdjudicateNarrative(w, targets[0] || null, isPass);

  const lastTarget = targets.length ? targets[targets.length - 1] : null;
  const winner = checkWinner(w);
  if (winner) {
    w.phase = winner === 'good' ? 'win' : 'lose';
    w.winner = winner;
    narrative += `\n\n${buildEndNarrative(w, lastTarget)}\n\n—— 游戏结束 ——\n\n【身份复盘】\n${w.players
      .map((p) => `  ${p.name}：${p.roleBackup ? `${ROLES[p.roleBackup]}（第${p.turnedRound || '?'}夜变身狼人）` : ROLES[p.role]}`)
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
    narrative += `\n\n${buildEndNarrative(w, lastTarget)}\n\n—— 游戏结束 ——\n\n【身份复盘】\n${w.players
      .map((p) => `  ${p.name}：${p.roleBackup ? `${ROLES[p.roleBackup]}（第${p.turnedRound || '?'}夜变身狼人）` : ROLES[p.role]}`)
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
  __test: { pickSuspect, settleNight, checkWinner, assignRoles, processTurn, extractClaim, fallbackSpeech },
};