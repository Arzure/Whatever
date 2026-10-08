const {
  runTurn,
  parseActionJson,
  unequipItem,
  cancelPendingAction,
  clearPendingActions,
} = require('../engine');
const { chat } = require('../llm');
const { generateCase, getGenre } = require('../casegen');

/**
 * 探案模式：在【代码持有的案件真相】之上，由 AI 演绎调查过程。
 *
 * 设计要点：
 * - 真相（game.case）由 casegen 生成并由代码持有，AI 只负责叙事与「按真相选台词」，无权改写真相。
 * - 线索进入背包（前缀「线索·」），物证进入单个装备槽（前缀「物证·」）。
 * - 线索与物证永久保留，不能被使用或丢弃。
 * - 玩家可随时指认凶手；指认错误扣血，扣光即失败。
 * - 指认正确后进入对质阶段，提交关键线索使其认罪，认罪成功即通关。
 */

const CLUE_PREFIX = '线索·';
const EVIDENCE_PREFIX = '物证·';
const MAX_HP = 100;
const ACCUSE_DAMAGE = 25; // 每次指认失败扣血
const CONFESS_RATIO = 0.6; // 认罪所需的关键线索覆盖率
const MAX_INVENTORY = 40;
const MAX_HISTORY = 60;

// ==================== 真相查询工具 ====================

function findSuspect(kase, id) {
  return (kase.suspects || []).find((s) => s.id === id) || null;
}

function findScene(kase, id) {
  return (kase.scenes || []).find((s) => s.id === id) || null;
}

function findEvidence(kase, id) {
  return (kase.evidence || []).find((e) => e.id === id) || null;
}

/** 按线索 id 找到「说出它的嫌疑人 + 口供本体」 */
function findStatement(kase, clueId) {
  for (const su of kase.suspects || []) {
    for (const st of su.statements || []) {
      if (st.id === clueId) return { suspect: su, st };
    }
  }
  return null;
}

/** 物品名「物证·账本」→ 物证对象 */
function equipNameToEvidence(kase, itemName) {
  const raw = String(itemName || '');
  const name = raw.startsWith(EVIDENCE_PREFIX) ? raw.slice(EVIDENCE_PREFIX.length) : raw;
  return (kase.evidence || []).find((e) => e.name === name) || null;
}

function trimHistory(history) {
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

/** 把一条口供记入线索清单（并作为「道具」放进背包，永久保留） */
function addClue(game, suspect, st) {
  const item = CLUE_PREFIX + st.text;
  // 说话人已被物证击破（或凶手已被指认）时，新获得的口供直接按其真伪标记
  const revealed = game.detective.revealed.includes(suspect.id);
  const status = revealed ? (st.truth ? 'confirmed' : 'false') : 'unknown';
  game.detective.clues.push({
    id: st.id,
    suspectId: suspect.id,
    suspectName: suspect.name,
    text: st.text,
    item,
    truth: st.truth,
    status, // unknown | confirmed | false
  });
  if (game.player.inventory.length < MAX_INVENTORY) game.player.inventory.push(item);
}

/** 某人的谎言被拆穿（或凶手被指认）后，对其全部口供作出真伪标记 */
function markSuspectClues(game, suspectId) {
  for (const c of game.detective.clues) {
    if (c.suspectId !== suspectId) continue;
    c.status = c.truth ? 'confirmed' : 'false';
  }
}

/** 当前场景内尚未被发现的物证 */
function hiddenEvidenceAt(kase, d) {
  return (kase.evidence || []).filter((e) => e.foundAt === d.currentScene && !d.evidenceIds.includes(e.id));
}

/**
 * 场景移动由代码确定性判定（文字输入与按钮双通道），
 * 避免把「玩家是否换了地方」交给 AI 判断而出现叙事与状态不一致。
 * @returns {object|null} 命中的场景
 */
function matchScene(kase, text) {
  const t = String(text || '');
  if (!t) return null;
  for (const sc of kase.scenes || []) {
    if (t.includes(sc.id)) return sc;
  }
  for (const sc of kase.scenes || []) {
    const keywords = String(sc.name)
      .split(/[与和·、，,／/｜|()（）\-—:：\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    if (keywords.some((k) => t.includes(k))) return sc;
  }
  return null;
}

/**
 * 物证击破由代码确定性判定：玩家当面出示「当前装备的物证」质问某位在场的人，
 * 且该物证恰好能反驳他（rebuts 命中）时即判定击破。
 * 不限于说谎者（isLiar）——若某件物证恰好能拆穿疑似凶手某句谎话，
 * 同样可以当场击破：凶手的假话一旦被物证盖穿，会改口补充只“部分”坦言的内容，
 * 但绝不会因此直接自证杀人（否则就绕开了认罪机制）。防剧透的约定由案件生成时保证。
 * 交给 AI 判断会出现「叙事里对方始终不松口」的卡死，故与场景切换一样收归程序。
 * @returns {object|null} 被击破的人（说谎者或凶手）
 */
function resolveRebuttal(game, text) {
  const d = game.detective;
  const equipped = (game.player.slots && game.player.slots.evidence) || null;
  if (!equipped) return null;
  const ev = equipNameToEvidence(game.case, equipped);
  if (!ev || !ev.rebuts || !ev.rebuts.length) return null;

  const scene = findScene(game.case, d.currentScene);
  const present = scene ? scene.npcs : [];
  const t = String(text || '');
  for (const id of ev.rebuts) {
    const su = findSuspect(game.case, id);
    // 击破不限定说谎者：物证能反驳的人（含凶手）都可被击破
    if (!su || d.revealed.includes(su.id) || !present.includes(su.id)) continue;
    // 玩家必须点明对象（人名）或亮明物证（物证名），避免误判
    if (t.includes(su.name) || t.includes(ev.name)) return su;
  }
  return null;
}

// ==================== 开局 ====================

/**
 * 初始化一局探案游戏（需要调用 LLM 生成案件，故为异步）。
 * @param {string} playerName 侦探名字
 * @param {{ genre: string }} opts 案件题材 id
 */
async function newGame(playerName, opts = {}) {
  const genre = getGenre(opts.genre);
  if (!genre) throw new Error('缺少有效的案件题材');

  const kase = await generateCase(genre.id);
  const startScene = kase.scenes[0] || null;

  const openingChoices = [];
  if (startScene) {
    openingChoices.push(`仔细勘查「${startScene.name}」`);
    for (const id of startScene.npcs.slice(0, 1)) {
      const su = findSuspect(kase, id);
      if (su) openingChoices.push(`盘问${su.name}`);
    }
    const elsewhere = (kase.scenes || []).find((s) => s.id !== startScene.id);
    if (elsewhere) openingChoices.push(`前往「${elsewhere.name}」`);
  }

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: 'detective',
    genre: kase.genre,
    theme: null,
    case: kase,
    player: {
      name: playerName || '无名侦探',
      hp: MAX_HP,
      maxHp: MAX_HP,
      inventory: [],
      slots: { evidence: null },
    },
    detective: {
      phase: 'investigate', // investigate | confront | win | lose
      currentScene: startScene ? startScene.id : '',
      visitedScenes: startScene ? [startScene.id] : [],
      clues: [], // {id, suspectId, suspectName, text, item, truth, status}
      evidenceIds: [],
      revealed: [], // 已被物证击破的说谎者 id
      accusedSuspectId: null,
      failedAccusations: 0,
    },
    // 以「开场简报」作为第一条旁白，前端直接展示
    history: [{ role: 'assistant', content: kase.opening, choices: openingChoices }],
    pendingActions: [],
  };
}

// ==================== 状态结算 ====================

/** 只保留探案模式认识的字段，其余一律忽略 */
function normalizeDelta(delta) {
  const d = delta && typeof delta === 'object' ? delta : {};
  const ids = (v) =>
    (Array.isArray(v) ? v : [])
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? x.id : ''))
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  return {
    scene: typeof d.scene === 'string' && d.scene.trim() ? d.scene.trim() : null,
    clues: ids(d.clues),
    evidence: ids(d.evidence),
    rebut: typeof d.rebut === 'string' && d.rebut.trim() ? d.rebut.trim() : null,
  };
}

/**
 * 应用 AI 给出的 delta：所有取值都必须能在案件真相中校验通过，否则丢弃。
 * @returns {string[]} effects 展示给玩家的结算提示
 */
function applyDelta(game, delta) {
  const kase = game.case;
  const d = game.detective;
  const effects = [];

  // 1. 场景切换
  if (delta.scene) {
    const sc = findScene(kase, delta.scene);
    if (sc && sc.id !== d.currentScene) {
      d.currentScene = sc.id;
      if (!d.visitedScenes.includes(sc.id)) d.visitedScenes.push(sc.id);
      effects.push(`前往「${sc.name}」`);
    }
  }

  const scene = findScene(kase, d.currentScene);
  const present = scene ? scene.npcs : [];

  // 2. 获得线索（只能来自当前在场者，且遵守说谎者/凶手的发言限制）
  for (const clueId of delta.clues) {
    if (d.clues.some((c) => c.id === clueId)) continue;
    const hit = findStatement(kase, clueId);
    if (!hit) continue;
    const { suspect, st } = hit;
    if (!present.includes(suspect.id)) continue;
    if (st.truth && suspect.isLiar && !d.revealed.includes(suspect.id)) continue; // 说谎者被击破前不吐真话
    if (!st.truth && d.revealed.includes(suspect.id)) continue; // 已被击破的人不再说谎
    addClue(game, suspect, st);
    effects.push(`获得线索「${st.text}」`);
  }

  // 3. 物证击破（说谎者或疑似凶手，不限定 isLiar）
  if (delta.rebut) {
    const su = findSuspect(kase, delta.rebut);
    const equipped = (game.player.slots && game.player.slots.evidence) || null;
    const ev = equipped ? equipNameToEvidence(kase, equipped) : null;
    if (su && ev && present.includes(su.id) && !d.revealed.includes(su.id) && ev.rebuts.includes(su.id)) {
      d.revealed.push(su.id);
      markSuspectClues(game, su.id);
      effects.push(`物证「${ev.name}」击破了「${su.name}」的谎言`);
      // 击破后其真话立刻到手（凶手被击破时，案件生成已保证其真话不直接自证杀人），
      // 避免玩家卡关（AI 通常也会在同一回合给出）
      for (const st of su.statements) {
        if (!st.truth || d.clues.some((c) => c.id === st.id)) continue;
        addClue(game, su, st);
        effects.push(`获得线索「${st.text}」`);
      }
    }
  }

  // 4. 发现物证（必须在当前场景）
  // 模型偶尔会「虚构」物证 id（如 sc2_某痕迹）——只要它认领了发现，而本场景确实还有
  // 未发现的物证，就把虚构 id 折算成真实物证，避免叙事说发现、状态却不变的死循环。
  const grants = [];
  let claimed = 0;
  for (const evId of delta.evidence) {
    const ev = findEvidence(kase, evId);
    if (!ev) { claimed += 1; continue; } // 虚构 id：计入兜底
    if (d.evidenceIds.includes(ev.id) || ev.foundAt !== d.currentScene) continue;
    if (!grants.includes(ev)) grants.push(ev);
  }
  if (claimed > 0) {
    for (const ev of hiddenEvidenceAt(kase, d)) {
      if (claimed <= 0) break;
      if (grants.includes(ev)) continue;
      grants.push(ev);
      claimed -= 1;
    }
  }
  for (const ev of grants) {
    d.evidenceIds.push(ev.id);
    const item = EVIDENCE_PREFIX + ev.name;
    if (game.player.inventory.length < MAX_INVENTORY) game.player.inventory.push(item);
    effects.push(`发现物证「${ev.name}」`);
  }

  return effects;
}

// ==================== 提示词 ====================

function compactCase(kase) {
  return JSON.stringify({
    title: kase.title,
    world: kase.world,
    victim: kase.victim,
    culpritId: kase.culpritId,
    crime: kase.crime,
    scenes: kase.scenes,
    evidence: kase.evidence,
    suspects: kase.suspects,
    keyClues: kase.keyClues,
  });
}

/** 列出在场人物尚未被玩家取得的口供（含 id 与是否可说）；已问尽的诚实 NPC 会明确标注 */
function presentStatementList(kase, d, present) {
  const lines = [];
  for (const su of present) {
    const pending = su.statements.filter((st) => !d.clues.some((c) => c.id === st.id));
    if (!pending.length) {
      // 该 NPC 的所有口供玩家都已取得：标记"已无可取得口供"，避免玩家继续无效盘问
      const isHiding = su.isLiar || su.isCulprit;
      lines.push(`    · ${su.name}：已无可取得的口供${isHiding ? '（仍在隐瞒，需物证击破或指认）' : '（诚实配合，已全部告知）'}`);
      continue;
    }
    for (const st of pending) {
      // 说谎者与凶手：truth=true 的口供在被物证击破（或凶手被指认）前都不可主动说出
      const needsRebuttal = su.isLiar || su.isCulprit;
      const blocked = st.truth && needsRebuttal && !d.revealed.includes(su.id);
      lines.push(`    · ${su.name} / ${st.id}${st.truth ? '' : '（此条不实）'}${blocked ? ' → 当前不可说出' : ''}`);
    }
  }
  return lines.length ? lines.join('\n') : '    （暂无可获取的口供）';
}

/**
 * 无效行动拦截：玩家盘问某位已问尽的诚实 NPC，或重复勘查已无物证可发现的场景时，
 * 程序直接给一句简短反馈并结束本回合（不调 LLM），避免「人人疑神疑鬼、无效推进冗长」。
 * @returns {object|null} { narrative, choices }；不命中返回 null
 */
function quickNoopReply(game, userInput) {
  const kase = game.case;
  const d = game.detective;
  const t = String(userInput || '');
  if (!t) return null;

  const scene = findScene(kase, d.currentScene);
  if (!scene) return null;
  const present = scene.npcs.map((id) => findSuspect(kase, id)).filter(Boolean);

  // 1) 盘问已问尽的在场诚实 NPC（非说谎者、非凶手，且口供全部取得）
  for (const su of present) {
    if (su.isLiar || su.isCulprit) continue;
    if (!t.includes(su.name)) continue;
    const pending = su.statements.filter((st) => !d.clues.some((c) => c.id === st.id));
    if (pending.length) continue; // 还有没拿到的话，正常走 LLM
    return {
      narrative: `${su.name}平静地摊了摊手：「我知道的都告诉你了，没有别的了。你要是还想去哪里看看，我随时配合。」`,
      choices: ['前往其他场景', '盘问其他人', '重新梳理已有线索'],
    };
  }

  // 2) 重复勘查已搜遍的场景（当前场景全部物证都已发现，且玩家行动明显是"搜索/勘查"意图）
  const searchWords = ['搜查', '搜索', '搜', '勘查', '勘察', '查看', '检查', '寻找', '找找', '翻', '搜找', '查找'];
  if (searchWords.some((w) => t.includes(w))) {
    const left = hiddenEvidenceAt(kase, d);
    if (!left.length) {
      return {
        narrative: `你把${scene.name}的每一处角落又过了一遍——抽屉、夹层、地面缝隙都翻过了，这里确实没有更多发现了。`,
        choices: ['前往其他场景', '盘问在场的人', '重新梳理已有线索'],
      };
    }
  }

  return null;
}

function buildSystemPrompt(game) {
  const kase = game.case;
  const d = game.detective;
  const scene = findScene(kase, d.currentScene);
  const present = (scene ? scene.npcs : []).map((id) => findSuspect(kase, id)).filter(Boolean);
  const sections = [];

  sections.push(
    `你是推理游戏「探案模式」的主持人，负责演绎一起【已经设计完成】的命案。\n` +
    `玩家扮演侦探，通过盘问嫌疑人、勘查现场、收集线索与物证，最终指认凶手、令其认罪。\n` +
    `你【不是】案件的作者：真相已经确定，你只能严格依据真相演绎台词与剧情，绝不能发明、改动或提前泄露真相。`
  );

  sections.push(
    `【输出格式 — 最高优先级，必须严格遵守】\n` +
    `每次回复必须是一个合法完整的 JSON 对象，此外不得输出任何内容（不要解释、不要代码块标记）：\n` +
    `{"narrative":"本回合剧情，中文，第二人称「你」，长度见下方字数规则","choices":["选项1","选项2","选项3"],"delta":{"scene":null,"clues":[],"evidence":[],"rebut":null}}\n` +
    `- delta.scene：玩家移动到新场景时填该场景 id，否则 null\n` +
    `- delta.clues：玩家本回合新获得的口供/线索 id 数组（没有则空数组）\n` +
    `- delta.evidence：玩家本回合发现的物证 id 数组（没有则空数组）\n` +
    `- delta.rebut：玩家用已装备的物证成功质问说谎者时，填该说谎者的 id，否则 null\n` +
    `【narrative 字数规则（重要）】\n` +
    `- 有实质进展的回合（获得新线索/物证/击破谎言/场景切换/指认举证）：150~350 字，写清该进展的来龙去脉即可。\n` +
    `- 无实质进展的回合（盘问已问尽的人、搜查已搜遍的场景、行动落空）：60~120 字，简短如实说明"没有新的发现"，不铺陈氛围、不硬凑字数。`
  );

  sections.push(`【案件真相（绝密，绝不可直接说破）】\n${compactCase(kase)}`);

  sections.push(
    `【当前局面】\n` +
    `- 阶段：${d.phase === 'confront' ? '对质（玩家已正确指认凶手，正试图举证令其认罪）' : '调查（玩家在自由搜集线索与物证）'}\n` +
    `- 当前位置：${scene ? `${scene.name} —— ${scene.desc}` : '未知'}\n` +
    `- 在场人物：${present.length ? present.map((s) => `${s.name}（${s.identity}，${s.relation}）`).join('；') : '（无人）'}\n` +
    `- 在场人物尚未被取得的口供：\n${presentStatementList(kase, d, present)}\n` +
    `- 玩家已获得的线索：${d.clues.length ? d.clues.map((c) => `${c.id}「${c.text}」`).join('；') : '（无）'}\n` +
    `- 玩家已获得的物证：${d.evidenceIds.length ? d.evidenceIds.map((id) => `物证·${findEvidence(kase, id)?.name}`).join('、') : '（无）'}\n` +
    `- 玩家当前装备的物证：${(game.player.slots && game.player.slots.evidence) || '无'}\n` +
    `- 已被物证击破的说谎者：${d.revealed.length ? d.revealed.map((id) => findSuspect(kase, id)?.name).join('、') : '（无）'}\n` +
    `- 当前场景尚未被发现的物证：${hiddenEvidenceAt(kase, d).map((e) => `${e.id}「${e.name}」`).join('、') || '（无）'}`
  );

  sections.push(
    `【核心规则 — 必须严格遵守】\n` +
    `1. 只演绎，不创作：所有台词、动机、手法、时间线都必须与【案件真相】完全一致。\n` +
    `2. 绝不主动说破凶手是谁，也绝不让 NPC 说出真相中不存在的信息。真相只能通过玩家自己指认与举证来揭开。\n` +
    `3. delta.clues 只填玩家【本回合确实从在场者口中取得】的口供 id（必须来自【案件真相】的 statements）。玩家盘问谁，就让谁按规则发言，并把取得的 id 填进 clues；玩家没有询问的人不要发言。\n` +
    `4. 说谎者（isLiar=true）在被物证击破前，只能说出 truth=false 的口供，并把谎言包装得像真话；被 delta.rebut 击破或已在「已被物证击破」名单中后，才说出 truth=true 的口供，并明确交代自己撒谎的原因（lieMotive）。\n` +
    `4.1 凶手（isCulprit=true）的假口供同样可能被对应物证击破：被击破后他会改口，只说「不直接指认自己杀人」的部分实话（onRebuttal），其 truth=true 的口供随之可得；但凶手绝不会因此当场认罪，认罪仍只能通过玩家指认后举证。\n` +
    `4.2 【诚实 NPC 的演绎基调——重要】只有 isLiar 的说谎者与凶手在隐瞒时，才会有躲闪、紧张、眼神游移、话里有话的表现；其余诚实 NPC（isLiar=false 且非凶手）说话【坦然、直接、配合调查】，不渲染他们心虚或可疑。若某个诚实 NPC 的线索玩家已经全部取得，再盘问他时，他应平静地说「我知道的都告诉你了，没有别的了」，而不是继续制造紧张气氛。\n` +
    `5. 凶手（isCulprit=true）在被正确指认前只会否认与推脱，只说出其 truth=false 的口供（被物证击破后按 4.1 处理）。\n` +
    `6. 【位置以「当前局面」为准，且不会因为你而改变】玩家是否移动由程序判定。当叙事涉及移动时，delta.scene 必须填目标场景 id（未填即视为没有移动，此时 narrative 中【绝不可】描写玩家已经离开当前位置）。玩家进入新场景时，要描写新场景的样貌。\n` +
    `6.1 【严禁描写不在场的人】narrative 只能出现「在场人物」名单里的人；其他人一律不得出场、发言或表态。若玩家想找不在场的人，要明确告知此人不在这里，并提示可以去哪里找他。\n` +
    `6.2 【叙事中不得出现内部编号】narrative 里只能用场景名、人物名与物证名，绝不能出现 sc1、s2、c3、e1 这类内部 id，也不要照抄 id 字样；场景样貌以【案件真相】里的 desc 为准，不得自行编造。\n` +
    `7. 【物证只能来自真相】delta.evidence 只能填【当前场景尚未被发现的物证】里已列出的 id（照抄，一个字符都不能改）；玩家没有在场景里搜找就不要给物证；绝不允许虚构真相之外的新物证、新 id 或新线索。若你在 narrative 中描写玩家发现了某件物证，就必须同时把它的 id 填进 delta.evidence。\n` +
    `8. delta.rebut 只在【玩家用当前装备的物证质问某人，且该物证恰好能反驳此人】时填写（不限于说谎者，凶手也可被击破）；填写时必须把该人所有 truth=true 的口供同时放进 delta.clues。\n` +
    `9. 玩家的生命值只由「指认失败」扣减，由程序结算，你不要填写任何血量变化。\n` +
    `10. narrative 结尾不要替玩家做决定；choices 给 2~3 个合乎当前情境的建议（如盘问某人、勘查某处、前往某地、指认某人）。`
  );

  return sections.join('\n\n');
}

/** 首次解析失败时使用的精简重试提示词 */
function buildRetryPrompt(game) {
  const kase = game.case;
  const d = game.detective;
  const scene = findScene(kase, d.currentScene);
  const present = (scene ? scene.npcs : []).map((id) => findSuspect(kase, id)).filter(Boolean);
  return [
    `你是「探案模式」的主持人，请严格以 JSON 输出本回合结果，不要输出任何其他文字：`,
    `{"narrative":"本回合剧情，第二人称，有实质进展150~350字、无进展60~120字","choices":["选项1","选项2"],"delta":{"scene":null,"clues":[],"evidence":[],"rebut":null}}`,
    `delta.clues 只能填玩家本回合从在场者处取得的口供 id，可选 id：`,
    presentStatementList(kase, d, present),
    `delta.evidence 只能填玩家本回合在本场景搜到的物证 id，可选 id：${hiddenEvidenceAt(kase, d).map((e) => e.id).join('、') || '（本场景已无可发现的物证，必须留空）'}`,
    `当前场景：${scene ? `${scene.name} —— ${scene.desc}` : '未知'}；在场：${present.map((s) => s.name).join('、') || '无人'}`,
    `narrative 中只能出现场景名、人物名、物证名，不得出现 sc1/s2/c3/e1 这类内部 id。`,
  ].join('\n');
}

function buildNarratePrompt(game) {
  const kase = game.case;
  const culprit = findSuspect(kase, kase.culpritId);
  return (
    `你是推理游戏「探案模式」的叙事主持。只输出一个 JSON 对象：{"narrative":"..."}，narrative 为 150~350 字中文剧情（无实质进展的补写场景可 60~120 字），第二人称「你」。\n` +
    `必须严格依据用户的指令（其中给出程序判定结果）撰写；不得改变判定结果，不得透露未被要求披露的真相。\n` +
    `【真相摘要】凶手：${culprit ? culprit.name : '未知'}；动机：${kase.crime.motive}；手法：${kase.crime.method}；破绽：${kase.crime.trick}\n` +
    `【案件】${kase.title} —— ${kase.world}`
  );
}

/** 调用 LLM 生成一段叙事；失败时回落到确定的模板文案 */
async function narrate(game, instruction, fallback) {
  try {
    const text = await chat(
      [
        { role: 'system', content: buildNarratePrompt(game) },
        { role: 'user', content: instruction },
      ],
      { temperature: 0.8, maxTokens: 800 }
    );
    const obj = parseActionJson(text);
    const narrative = String((obj && obj.narrative) || '').trim();
    if (narrative) return narrative.slice(0, 1500);
  } catch (err) {
    console.log('[debug] 探案叙事失败:', String(err.message).slice(0, 80));
  }
  return fallback;
}

/** 统一的回合返回结构 */
function resultPayload(game, extra) {
  const phase = game.detective.phase;
  return {
    narrative: extra.narrative,
    choices: extra.choices || [],
    effects: extra.effects || [],
    player: game.player,
    detective: game.detective,
    pendingActions: game.pendingActions,
    phase,
    gameOver: phase === 'win' || phase === 'lose',
    degraded: !!extra.degraded,
    // 案件告破信息（仅 win 时携带；平时为 null，避免泄露 keyClues）
    caseResult: extra.caseResult || null,
  };
}

/** 渲染侦探状态（供提示词/调试使用） */
function renderPlayer(game) {
  const d = game.detective;
  return [
    `- 姓名：${game.player.name}`,
    `- 生命：${game.player.hp}/${game.player.maxHp}`,
    `- 装备的物证：${(game.player.slots && game.player.slots.evidence) || '无'}`,
    `- 已掌握线索：${d.clues.length} 条`,
    `- 已获物证：${d.evidenceIds.length} 件`,
    `- 已指认失败：${d.failedAccusations} 次`,
  ].join('\n');
}

/** 是否已结束；供路由统一拦截 */
function checkOver(game) {
  const phase = game && game.detective && game.detective.phase;
  if (phase === 'win') return { over: true, reason: 'win', message: '案件已经侦破，游戏结束' };
  if (phase === 'lose' || (game && game.player && game.player.hp <= 0)) {
    return { over: true, reason: 'lose', message: '侦探已经倒下，案件无疾而终' };
  }
  return { over: false, reason: '', message: '' };
}

// ==================== 核心回合 ====================

/**
 * 执行一个回合。
 * @param {string} userInput 玩家输入（文字通道）
 * @param {{ sceneId?: string }} opts 可选的显式目标场景（按钮通道）
 */
async function processAction(game, userInput, opts = {}) {
  const d = game.detective;
  const effects = [];

  // 场景移动：代码确定性判定（按钮优先，其次从文字输入中识别场景名）
  const target = (opts.sceneId && findScene(game.case, String(opts.sceneId))) || matchScene(game.case, userInput);
  if (target && target.id !== d.currentScene) {
    d.currentScene = target.id;
    if (!d.visitedScenes.includes(target.id)) d.visitedScenes.push(target.id);
    effects.push(`前往「${target.name}」`);
  }

  let mergedInput = userInput;
  if (game.pendingActions && game.pendingActions.length) {
    const pendingDesc = game.pendingActions.map((p) => `（动作：${p.message}）`).join('，');
    mergedInput = `${userInput}。此前你已通过快捷按钮执行：${pendingDesc}，请据此推进剧情。`;
    clearPendingActions(game);
  }

  // 物证击破谎言：与场景切换一样由代码确定性判定（玩家当面出示已装备的物证质问说谎者）
  const rebutted = resolveRebuttal(game, userInput);
  if (rebutted) {
    d.revealed.push(rebutted.id);
    markSuspectClues(game, rebutted.id);
    const ev = equipNameToEvidence(game.case, game.player.slots.evidence);
    effects.push(`物证「${ev ? ev.name : ''}」击破了「${rebutted.name}」的谎言`);
    for (const st of rebutted.statements) {
      if (!st.truth || d.clues.some((c) => c.id === st.id)) continue;
      addClue(game, rebutted, st);
      effects.push(`获得线索「${st.text}」`);
    }
  }

  // 无效行动拦截：盘问已问尽的诚实 NPC（或重复勘查已搜遍的场景）时，直接给简短反馈，
  // 不再调 LLM 写长篇悬疑剧情，避免「人人疑神疑鬼 + 无效推进冗长」。
  const noop = quickNoopReply(game, userInput);
  if (noop) {
    game.history.push({ role: 'user', content: userInput });
    game.history.push({ role: 'assistant', content: noop.narrative, choices: noop.choices });
    trimHistory(game.history);
    game.updatedAt = Date.now();
    return resultPayload(game, { narrative: noop.narrative, choices: noop.choices, effects });
  }

  // 把程序结算明确告知 AI，使叙事与状态保持一致
  if (effects.length) {
    mergedInput = `${mergedInput}\n（程序结算：${effects.join('；')}。这是既定事实，请据此演绎，不要推翻判定。）`;
  }

  game.history.push({ role: 'user', content: mergedInput });

  const messages = [
    { role: 'system', content: buildSystemPrompt(game) },
    ...game.history.map((h) => ({ role: h.role, content: h.content })),
  ];
  const retryMessages = [
    { role: 'system', content: buildRetryPrompt(game) },
    { role: 'user', content: `玩家行动：${mergedInput}\n请以 JSON 输出本回合结果。` },
  ];

  const { action, narrative: degradedText } = await runTurn({ messages, retryMessages, maxTokens: 4096 });

  // 降级接续：模型固执输出纯文本时直接接续剧情，不打断游戏
  if (action === null) {
    const narrative = degradedText;
    if (!narrative) throw new Error('AI 返回了空内容，请重试一次');
    game.history.push({ role: 'assistant', content: narrative, choices: [] });
    trimHistory(game.history);
    game.updatedAt = Date.now();
    return resultPayload(game, { narrative, effects, degraded: true });
  }

  const delta = normalizeDelta(action.delta);
  effects.push(...applyDelta(game, delta));

  // 模型偶尔会漏掉 narrative：补写一段，避免玩家看到空白剧情
  let narrative = String(action.narrative || '').trim();
  let degraded = false;
  if (!narrative) {
    degraded = true;
    narrative = await narrate(
      game,
      `玩家行动：${mergedInput}\n程序结算：${effects.join('；') || '本回合没有新的进展'}\n请据此补写本回合剧情。`,
      effects.length ? `（本回合进展：${effects.join('；')}。）` : '你在原处又看了一遍，暂时没有新的发现。'
    );
  }

  const choices = Array.isArray(action.choices) ? action.choices.slice(0, 3).map(String) : [];
  game.history.push({ role: 'assistant', content: narrative, choices });
  trimHistory(game.history);
  game.updatedAt = Date.now();

  return resultPayload(game, { narrative: narrative.slice(0, 2000), choices, effects, degraded });
}

// ==================== 指认与认罪 ====================

/** 指认叙事兜底文案 */
function accuseFallback(game, su, correct) {
  if (correct) {
    return (
      `你停下翻检的动作，抬眼直视${su.name}，一字一句地说出了那个名字。\n\n` +
      `${su.name}的神情僵了一瞬。那点不自然很快被压了下去，${su.name}干笑一声，反问你凭什么这样污蔑，语气里却多了一丝此前从未有过的紧绷。\n\n` +
      `你心里已经有了答案。但想让他开口认罪，还差最后一步——拿出证据，一条一条把他逼到无处可退。`
    );
  }
  return (
    `你沉吟片刻，指向${su.name}，把推断的来龙去脉说了出来。\n\n` +
    `然而${su.name}只是冷冷看着你，随即毫不留情地驳斥了你的说法：你所依据的那点东西，根本经不起推敲。\n\n` +
    `旁人的目光变得犹疑起来。这一局你失了先手——若再贸然开口，恐怕真相还没来得及浮出水面，你就已经耗尽了继续追查的余地。`
  );
}

/** 认罪成功叙事兜底文案 */
function winFallback(game) {
  const su = findSuspect(game.case, game.detective.accusedSuspectId);
  const name = su ? su.name : '凶手';
  return (
    `一条，又一条。你把掌握的线索依次摆到${name}面前，每一句都精准地落在对方话里的破绽上。\n\n` +
    `${name}的辩解越来越短，越来越乱，最后彻底沉默下来。良久，那张一直强撑着的脸上终于裂开一道缝隙。\n\n` +
    `「……是我。」${name}的声音很低，「你们不会明白，我等这一天，等了多久。」\n\n` +
    `案件的真相就此完整地摊开在灯光之下。你合上手里的记录，长出了一口气。`
  );
}

/** 举证失败叙事兜底文案（不扣血、线索不消耗） */
function confessFailFallback(game, have, need) {
  const su = findSuspect(game.case, game.detective.accusedSuspectId);
  const name = su ? su.name : '凶手';
  return (
    `你把几桩事情摆到${name}面前，试图把它们串成一条完整的锁链。\n\n` +
    `但${name}只是听着，末了轻轻摇了摇头：「就凭这些？你证明不了任何事情。」\n\n` +
    `你不得不承认，眼下的证据链还缺了关键的一环（目前有力的关键线索 ${have}/${need} 条）。线索不会白费，但要让对方彻底认罪，你还需要再去挖出些什么。`
  );
}

/** 生命耗尽叙事兜底文案 */
function hpZeroFallback(game, su) {
  const name = su ? su.name : '对方';
  return (
    `你再一次指向${name}，可话音刚落，四周的质疑声便一齐压了过来。\n\n` +
    `连日奔波与接二连三的失手，已经把你的精力掏空。你眼前一黑，扶住桌沿却终究没能站稳，意识沉了下去。\n\n` +
    `案卷被合上，真相再无人问津。`
  );
}

/**
 * 指认凶手（两步机制的第一步）。仅在调查阶段可用。
 * 指认正确 → 进入对质阶段；指认错误 → 扣血，血量清零则失败。
 * @param {string} suspectId
 * @returns {Promise<{ok: boolean, message: string, payload?: object}>}
 */
async function accuse(game, suspectId) {
  const kase = game.case;
  const d = game.detective;

  if (d.phase === 'confront') {
    return { ok: false, message: '你已指认了凶手，请提交关键线索令他认罪' };
  }
  if (d.phase === 'win' || d.phase === 'lose') {
    return { ok: false, message: '案件已经结束' };
  }

  const su = findSuspect(kase, String(suspectId || ''));
  if (!su) return { ok: false, message: '没有这个嫌疑人' };

  const correct = su.id === kase.culpritId;
  let effects = [];
  let instruction;
  let fallback;

  if (correct) {
    d.phase = 'confront';
    d.accusedSuspectId = su.id;
    markSuspectClues(game, su.id);
    effects = [`当众指认「${su.name}」为凶手`];
    instruction =
      `玩家正式指认「${su.name}」为凶手，程序判定：正确。\n` +
      `请描写玩家当面揭穿、${su.name}神色骤变却仍强作镇定、矢口否认的场面（250~450字，第二人称「你」）。\n` +
      `结尾要点明：只凭指认还不够，必须拿出关键线索才能令其真正认罪。\n绝对不要在此处就让对方认罪。`;
    fallback = accuseFallback(game, su, true);
  } else {
    d.failedAccusations += 1;
    game.player.hp = Math.max(0, game.player.hp - ACCUSE_DAMAGE);
    const dead = game.player.hp <= 0;
    if (dead) d.phase = 'lose';
    effects = [`指认「${su.name}」失败，生命 -${ACCUSE_DAMAGE}`];
    instruction = dead
      ? `玩家指认「${su.name}」为凶手，程序判定：错误，且玩家生命已归零，游戏失败。\n` +
        `请描写玩家因连续失误而心力交瘁、最终倒下的场面（250~400字，第二人称「你」），基调沉重，不要透露真正的凶手是谁。`
      : `玩家指认「${su.name}」为凶手，程序判定：错误，玩家生命 -${ACCUSE_DAMAGE}（当前 ${game.player.hp}）。\n` +
        `请描写${su.name}如何有理有据地反驳、玩家如何失了先手的场面（250~400字，第二人称「你」）。\n` +
        `绝对不要透露真正的凶手是谁，也不要暗示玩家应该去指认谁。`;
    fallback = dead ? hpZeroFallback(game, su) : accuseFallback(game, su, false);
  }

  const narrative = await narrate(game, instruction, fallback);
  const choices = correct
    ? ['整理已掌握的线索', '再去找人核实', '前往其他场景']
    : ['重新梳理线索', '换个方向盘问', '前往其他场景'];
  game.history.push({ role: 'assistant', content: narrative, choices });
  trimHistory(game.history);
  game.updatedAt = Date.now();

  return { ok: true, message: effects[0], payload: resultPayload(game, { narrative, choices, effects }) };
}

/**
 * 举证令凶手认罪（两步机制的第二步）。仅在对质阶段可用。
 * 覆盖度达到关键线索的 CONFESS_RATIO 即认罪成功；失败不扣血，线索不消耗。
 * @param {string[]} clueIds 玩家提交的线索 id
 */
async function confront(game, clueIds) {
  const kase = game.case;
  const d = game.detective;

  if (d.phase !== 'confront') {
    return { ok: false, message: d.phase === 'investigate' ? '你还没有指认凶手' : '案件已经结束' };
  }

  const su = findSuspect(kase, d.accusedSuspectId);
  const keyClues = kase.keyClues || [];
  const owned = new Set(d.clues.map((c) => c.id));
  const submitted = (Array.isArray(clueIds) ? clueIds : [])
    .map((x) => String((x && x.id) || x || '').trim())
    .filter((id) => owned.has(id));

  if (!submitted.length) return { ok: false, message: '请至少提交一条你已掌握的线索' };

  const hit = keyClues.filter((id) => submitted.includes(id));
  const required = Math.max(1, Math.ceil(keyClues.length * CONFESS_RATIO));
  const success = hit.length >= required;
  let effects = [];
  let instruction;
  let fallback;
  let caseResult = null;

  if (success) {
    d.phase = 'win';
    for (const c of d.clues) c.status = c.truth ? 'confirmed' : 'false';
    effects = [`举证成立（关键线索 ${hit.length}/${keyClues.length}），凶手认罪`];
    instruction =
      `玩家在对质中提交了一组关键线索，程序判定：覆盖度达标，凶手「${su ? su.name : ''}」认罪，案件告破。\n` +
      `请描写凶手防线彻底崩溃、低头认罪并简短交代动机的场面（300~500字，第二人称「你」），基调收束、有余韵。\n` +
      `可以用凶手自己的口吻说出他的动机与手法，但必须与真相一致。`;
    fallback = winFallback(game);
    // 告破后向玩家复盘：哪些关键证据命中、还有哪些关键证据未获取（此时真相已公开，可展示）
    const clueText = (id) => {
      const c = d.clues.find((x) => x.id === id);
      if (c) return { text: c.text, holder: c.suspectName };
      const owner = findStatement(kase, id);
      return owner ? { text: owner.st.text, holder: owner.suspect.name } : { text: id, holder: '' };
    };
    const got = hit.map(clueText);
    const missing = keyClues.filter((id) => !owned.has(id)).map(clueText);
    caseResult = { got, missing, total: keyClues.length };
  } else {
    effects = [`举证失败（关键线索 ${hit.length}/${keyClues.length} 有效），未达到 ${required} 条`];
    instruction =
      `玩家在对质中提交了一组线索，程序判定：覆盖度不足（仅 ${hit.length}/${keyClues.length} 条为关键线索，需要 ${required} 条），凶手仍未认罪。\n` +
      `请描写凶手如何轻描淡写地挡回玩家的举证（250~400字，第二人称「你」），并让玩家意识到证据链还缺关键环节。\n` +
      `不要因此加重对凶手的指认，也不要透露还差哪些具体线索。`;
    fallback = confessFailFallback(game, hit.length, required);
  }

  const narrative = await narrate(game, instruction, fallback);
  const choices = success ? [] : ['回去继续搜集线索', '整理已有线索再试', '重新勘查现场'];
  game.history.push({ role: 'assistant', content: narrative, choices });
  trimHistory(game.history);
  game.updatedAt = Date.now();

  return { ok: true, message: effects[0], payload: resultPayload(game, { narrative, choices, effects, caseResult }) };
}

// ==================== 对外状态视图（剔除真相，防止前端泄露谜底） ====================

/**
 * 构建可安全下发给前端的探案状态：
 * - 绝不包含 isCulprit / isLiar / truth / crime / keyClues 等真相字段。
 * - 完整案件说明（含谜底）只由 GET /api/games/:id/case 在玩家主动展开时提供。
 */
function snapshot(game) {
  const kase = game.case || {};
  const d = game.detective;
  const scene = findScene(kase, d.currentScene);
  const present = (scene ? scene.npcs : [])
    .map((id) => findSuspect(kase, id))
    .filter(Boolean)
    .map((s) => ({ id: s.id, name: s.name, identity: s.identity }));

  // 证据复盘只在案件告破（win）后下发：调查阶段绝不泄露哪些是关键线索
  let caseResult = null;
  if (d.phase === 'win') {
    const keyClues = kase.keyClues || [];
    const owned = new Set(d.clues.map((c) => c.id));
    const clueText = (id) => {
      const c = d.clues.find((x) => x.id === id);
      if (c) return { text: c.text, holder: c.suspectName };
      const owner = findStatement(kase, id);
      return owner ? { text: owner.st.text, holder: owner.suspect.name } : { text: id, holder: '' };
    };
    caseResult = {
      got: keyClues.filter((id) => owned.has(id)).map(clueText),
      missing: keyClues.filter((id) => !owned.has(id)).map(clueText),
      total: keyClues.length,
    };
  }

  return {
    genre: game.genre || null,
    caseTitle: kase.title || '',
    detective: {
      phase: d.phase,
      currentScene: d.currentScene,
      visitedScenes: d.visitedScenes,
      failedAccusations: d.failedAccusations,
      accusedSuspectId: d.accusedSuspectId,
      evidenceIds: d.evidenceIds,
      revealed: d.revealed,
      clues: d.clues.map((c) => ({
        id: c.id,
        suspectId: c.suspectId,
        suspectName: c.suspectName,
        text: c.text,
        item: c.item,
        status: c.status,
      })),
    },
    scenes: (kase.scenes || []).map((s) => ({ id: s.id, name: s.name, visited: d.visitedScenes.includes(s.id) })),
    suspects: (kase.suspects || []).map((s) => ({ id: s.id, name: s.name, identity: s.identity })),
    present,
    // 物证明细（含描述）：前端物证栏展示，名称用于与背包「物证·」条目匹配
    evidence: (kase.evidence || []).map((e) => ({
      id: e.id,
      name: e.name,
      desc: e.desc,
      foundAt: (() => { const sc = findScene(kase, e.foundAt); return sc ? sc.name : ''; })(),
    })),
    caseResult,
    gameOver: checkOver(game),
  };
}

// ==================== 存档摘要 ====================

function summarize(game) {
  return {
    playerName: game.player.name,
    level: 1,
    mode: 'detective',
    themeName: '',
    caseTitle: (game.case && game.case.title) || '',
  };
}

// ==================== 物品操作（探案模式专用：线索与物证永久保留） ====================

/** 线索与物证是推理凭证，不能「使用」 */
function useItem() {
  return { ok: false, message: '线索与物证是推理的凭证，无法使用' };
}

/** 线索与物证必须保留到案件结束，不能丢弃 */
function discardItem() {
  return { ok: false, message: '线索与物证必须保留到案件结束，无法丢弃' };
}

/** 装备物证到唯一的物证槽 */
function equipItem(game, itemName) {
  const raw = String(itemName || '');
  if (!raw.startsWith(EVIDENCE_PREFIX)) {
    return { ok: false, message: '只有物证可以装备' };
  }
  if (!equipNameToEvidence(game.case, raw)) {
    return { ok: false, message: `「${raw}」不是本案的物证` };
  }
  const player = game.player;
  const idx = player.inventory.indexOf(raw);
  if (idx === -1) return { ok: false, message: `背包里没有「${raw}」` };
  if (player.slots.evidence === raw) return { ok: false, message: `已经装备了「${raw}」` };
  player.inventory.splice(idx, 1);
  if (player.slots.evidence) player.inventory.push(player.slots.evidence);
  player.slots.evidence = raw;
  game.pendingActions.push({ type: 'equip', slot: 'evidence', item: raw, message: `装备物证「${raw}」` });
  game.updatedAt = Date.now();
  return { ok: true, message: `已装备「${raw}」` };
}

module.exports = {
  modeId: 'detective',
  modeName: '探案模式',
  needsTheme: false,
  needsGenre: true,
  needsLLM: true,
  newGame,
  processAction,
  accuse,
  confront,
  renderPlayer,
  buildSystemPrompt,
  checkOver,
  snapshot,
  summarize,
  useItem,
  discardItem,
  equipItem,
  unequipItem,
  cancelPendingAction,
  clearPendingActions,
};
