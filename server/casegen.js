const { chat } = require('./llm');
const { parseActionJson } = require('./engine');

/**
 * 案件生成器（探案模式）。
 *
 * 探案模式与自由探索的大世界模式不同：案件必须【唯一可解、逻辑自洽】，
 * 因此真相由代码持有（存档 game.case），AI 只在这份真相的约束下演绎台词与剧情。
 * 本模块负责：题材定义 → 交给 AI 设计案件 → 归一化 → 结构校验（不通过则重试）。
 */

/** 案件题材（后端为唯一事实来源，前端读取 /api/genres） */
const GENRES = [
  { id: 'modern', name: '现代都市', hint: '当代城市背景，警方与私家侦探，物证可为监控、指纹、通话记录、门禁等' },
  { id: 'ancient', name: '古代衙门', hint: '中国古代背景，公堂、仵作、江湖恩怨，物证多为器物、书信、尸格痕迹' },
  { id: 'republic', name: '民国旧案', hint: '民国时期租界旧城，洋行、报馆、帮会，氛围阴郁悬疑' },
  { id: 'fantasy', name: '奇幻王国', hint: '剑与魔法的奇幻世界，可有秘药、契约、魔法痕迹，但推理链条仍须自洽' },
];

const MAX_ATTEMPTS = 3;
const MAX_SUSPECTS = 5;

const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const arr = (v) => (Array.isArray(v) ? v : []);
const isTrue = (v) => v === true || v === 'true';

function listGenres() {
  return GENRES.map((g) => ({ id: g.id, name: g.name, hint: g.hint }));
}

function getGenre(id) {
  return GENRES.find((g) => g.id === s(id, 20)) || null;
}

/** 生成案件的元提示词 */
function buildGenPrompt(genre, problems) {
  return (
    `你是推理游戏「探案模式」的案件设计师。请为题材「${genre.name}」设计一起【结构完整、逻辑自洽、唯一可解】的命案，只输出一个 JSON 对象（不要任何解释、不要代码块标记）。\n\n` +
    `题材风格：${genre.hint}\n\n` +
    `输出结构（字段含义见下方硬性规则）：\n` +
    `{"title":"案件名（6~14字）",` +
    `"world":"世界设定：时代、地点、氛围（80~150字）",` +
    `"opening":"开场简报：第二人称「你」，描述案件被发现与你受托调查（150~250字）；只描述现象，绝不透露凶手、动机与手法",` +
    `"victim":{"name":"","identity":"","causeOfDeath":"","foundAt":"sc1","foundTime":""},` +
    `"culpritId":"s2",` +
    `"crime":{"motive":"","method":"","timeWindow":"","sceneId":"sc1","trick":""},` +
    `"suspects":[{"id":"s1","name":"","identity":"身份","relation":"与受害者的关系","isCulprit":false,"isLiar":false,"lieMotive":"","rebuttalEvidenceId":null,"onRebuttal":"","statements":[{"id":"c1","text":"这条口供/线索的具体内容","truth":true}]}],` +
    `"scenes":[{"id":"sc1","name":"","desc":"","npcs":["s1","s2"]}],` +
    `"evidence":[{"id":"e1","name":"物证名","desc":"","foundAt":"sc1","rebuts":["s1"]}],` +
    `"keyClues":["c3","c4"]}\n\n` +
    `硬性规则：\n` +
    `1. 嫌疑人 3~5 名，id 用 s1..sN；恰好 1 名 isCulprit=true，且 culpritId 等于该人 id。\n` +
    `2. 至少 1 名【说谎者】：必须是【非凶手】，isLiar=true，并写明 lieMotive（合理的隐瞒动机）。说谎者至少有 1 条 truth=false 的假线索、至少 1 条 truth=true 的真实线索。\n` +
    `3. 说谎者必须能被物证击破：rebuttalEvidenceId 指向某件物证的 id，且该物证的 rebuts 数组必须包含这名说谎者的 id；onRebuttal 写明他被击破后的反应（改口交代真相 + 说明撒谎原因）。\n` +
    `4. 其余嫌疑人 isLiar=false，statements 全部 truth=true。凶手在未被正确指认前只会否认，因此凶手至少有 1 条 truth=false 的否认式口供。\n` +
    `5. 线索 id 全局唯一，用 c1、c2、c3… 连续编号；线索内容要具体、可复述（如「案发时段只有她进过钟楼」），不要空话。\n` +
    `6. keyClues 是「足以让凶手无法辩驳」的关键线索 id 列表（2~4 条），硬性要求：\n` +
    `   - 每条都必须出现在某个嫌疑人的 statements 中；\n` +
    `   - 不得来自凶手（否则玩家拿不到）：撰写时先写清凶手是谁，再把他名下的所有口供 id 一一排除，只从其余嫌疑人中挑选；\n` +
    `   - 至少 1 条来自说谎者的真话（玩家必须先用物证击破他才能获得）。\n` +
    `7. 场景 2~4 个，id 用 sc1..scN，每个场景写明在场嫌疑人（npcs）；victim.foundAt 与 crime.sceneId 必须是已定义的场景 id。\n` +
    `8. 物证 2~4 件，id 用 e1..eN，每件都要有 foundAt（发现它的场景 id）。物证既是辨别线索真假的工具，也可以只是氛围道具。\n` +
    `9. 真相必须唯一：依据 keyClues 能唯一锁定 culpritId，凶手的动机与手法能自洽解释现场。\n` +
    `10. 全部文本用中文，不要出现「某」「某某」这类占位词。\n` +
    (problems && problems.length
      ? `\n上一次生成存在以下问题，请务必修正：\n- ${problems.join('\n- ')}`
      : '')
  );
}

/** 归一化：砍掉多余字段、补齐缺失 id、修正结构性引用（不判定逻辑对错） */
function normalizeCase(raw, genre) {
  const o = raw && typeof raw === 'object' ? raw : {};

  const scenes = arr(o.scenes)
    .slice(0, 6)
    .map((sc, i) => ({
      id: s(sc?.id, 16) || `sc${i + 1}`,
      name: s(sc?.name, 20) || `场景${i + 1}`,
      desc: s(sc?.desc, 200),
      npcs: arr(sc?.npcs).map((x) => s(x, 16)).filter(Boolean),
    }));
  const sceneIds = scenes.map((x) => x.id);

  const evidence = arr(o.evidence)
    .slice(0, 6)
    .map((e, i) => {
      const foundAt = s(e?.foundAt, 16);
      return {
        id: s(e?.id, 16) || `e${i + 1}`,
        name: s(e?.name, 24) || `物证${i + 1}`,
        desc: s(e?.desc, 200),
        foundAt: sceneIds.includes(foundAt) ? foundAt : sceneIds[0] || '',
        rebuts: arr(e?.rebuts).map((x) => s(x, 16)).filter(Boolean),
      };
    });

  let seq = 0;
  const suspects = arr(o.suspects)
    .slice(0, MAX_SUSPECTS)
    .map((su, i) => {
      const row = su && typeof su === 'object' ? su : {};
      const statements = arr(row.statements)
        .slice(0, 6)
        .map((st) => {
          seq += 1;
          return {
            id: s(st?.id, 16) || `c${seq}`,
            text: s(st?.text, 120),
            truth: !(st?.truth === false || st?.truth === 'false'),
          };
        })
        .filter((st) => st.text);
      const rebuttalEvidenceId = s(row.rebuttalEvidenceId, 16);
      return {
        id: s(row.id, 16) || `s${i + 1}`,
        name: s(row.name, 20) || `嫌疑人${i + 1}`,
        identity: s(row.identity, 40),
        relation: s(row.relation, 60),
        isCulprit: isTrue(row.isCulprit),
        isLiar: isTrue(row.isLiar),
        lieMotive: s(row.lieMotive, 120),
        rebuttalEvidenceId: rebuttalEvidenceId || null,
        onRebuttal: s(row.onRebuttal, 200),
        statements,
      };
    });
  const suspectIds = suspects.map((x) => x.id);

  // 场景 npcs 指向不存在的嫌疑人时剔除
  for (const sc of scenes) sc.npcs = sc.npcs.filter((n) => suspectIds.includes(n));
  // 物证 rebuts 指向不存在的嫌疑人时剔除
  for (const e of evidence) e.rebuts = e.rebuts.filter((n) => suspectIds.includes(n));

  const crime = o.crime && typeof o.crime === 'object' ? o.crime : {};
  const crimeScene = s(crime.sceneId, 16);
  const victim = o.victim && typeof o.victim === 'object' ? o.victim : {};
  const victimFoundAt = s(victim.foundAt, 16);

  // 线索归属：clueId -> 是否凶手所有。凶手在认罪前只会否认，其口供玩家根本拿不到，
  // 因此凶手名下的线索一律不能作为 keyClues（模型时常误选，这里按结构确定性剔除）。
  const clueOwnedByCulprit = {};
  for (const su of suspects) for (const st of su.statements) clueOwnedByCulprit[st.id] = su.isCulprit;

  const keyClues = [];
  for (const x of arr(o.keyClues)) {
    const id = s(x, 16);
    if (!id || keyClues.includes(id)) continue;
    if (!(id in clueOwnedByCulprit)) continue; // 无效引用
    if (clueOwnedByCulprit[id]) continue; // 凶手口供：不可获得
    keyClues.push(id);
  }

  return {
    genre: { id: genre.id, name: genre.name },
    title: s(o.title, 24) || `${genre.name}疑案`,
    world: s(o.world, 400),
    opening: s(o.opening, 600),
    victim: {
      name: s(victim.name, 20) || '死者',
      identity: s(victim.identity, 40),
      causeOfDeath: s(victim.causeOfDeath, 60),
      foundAt: sceneIds.includes(victimFoundAt) ? victimFoundAt : (sceneIds[0] || ''),
      foundTime: s(victim.foundTime, 40),
    },
    culpritId: s(o.culpritId, 16),
    crime: {
      motive: s(crime.motive, 200),
      method: s(crime.method, 200),
      timeWindow: s(crime.timeWindow, 60),
      sceneId: sceneIds.includes(crimeScene) ? crimeScene : (sceneIds[0] || ''),
      trick: s(crime.trick, 200),
    },
    suspects,
    scenes,
    evidence,
    keyClues,
  };
}

/**
 * 结构校验：只检查「能否支撑探案玩法」的必要条件，不评判文笔。
 * @returns {string[]} 问题列表，为空表示通过
 */
function validateCase(c) {
  const problems = [];
  const suspects = arr(c.suspects);
  const scenes = arr(c.scenes);
  const evidence = arr(c.evidence);

  if (suspects.length < 3) problems.push('嫌疑人少于 3 名');
  if (scenes.length < 2) problems.push('场景少于 2 个');
  if (evidence.length < 2) problems.push('物证少于 2 件');

  const culprits = suspects.filter((x) => x.isCulprit);
  if (culprits.length !== 1) {
    problems.push(`凶手必须恰好 1 名（当前 ${culprits.length} 名）`);
  } else if (culprits[0].id !== c.culpritId) {
    problems.push('culpritId 与 isCulprit=true 的嫌疑人不一致');
  }

  // 线索归属表：clueId -> 说出它的嫌疑人
  const clueOwner = {};
  for (const su of suspects) {
    if (!su.statements.length) problems.push(`嫌疑人「${su.name}」没有任何口供/线索`);
    for (const st of su.statements) clueOwner[st.id] = su;
  }

  // 说谎者规则
  const liars = suspects.filter((x) => x.isLiar);
  if (!liars.length) problems.push('至少需要 1 名说谎者（必须是非凶手）');
  const liarTrueClues = new Set();
  for (const L of liars) {
    if (L.isCulprit) {
      problems.push(`说谎者「${L.name}」不能同时是凶手`);
      continue;
    }
    if (!L.lieMotive) problems.push(`说谎者「${L.name}」缺少合理的撒谎动机 lieMotive`);
    if (!L.onRebuttal) problems.push(`说谎者「${L.name}」缺少被击破后的反应 onRebuttal`);

    const ev = evidence.find((e) => e.id === L.rebuttalEvidenceId);
    if (!ev) problems.push(`说谎者「${L.name}」的 rebuttalEvidenceId 未指向有效物证`);
    else if (!ev.rebuts.includes(L.id)) problems.push(`物证「${ev.name}」的 rebuts 未包含说谎者「${L.name}」`);

    const sts = L.statements;
    if (!sts.some((st) => st.truth === false)) problems.push(`说谎者「${L.name}」至少要有 1 条假线索`);
    if (!sts.some((st) => st.truth === true)) problems.push(`说谎者「${L.name}」至少要有 1 条真实线索`);
    for (const st of sts) if (st.truth) liarTrueClues.add(st.id);
  }

  // 凶手必须有否认式假口供
  for (const cu of culprits) {
    if (!cu.statements.some((st) => st.truth === false)) {
      problems.push(`凶手「${cu.name}」至少要有 1 条否认式假口供`);
    }
  }

  // 关键线索规则
  const kc = arr(c.keyClues);
  if (kc.length < 2) problems.push('keyClues 不足 2 条：请从【非凶手】嫌疑人说出的线索中，挑 2~4 条足以锁定凶手的（凶手名下的口供玩家拿不到，不能算）');
  for (const id of kc) {
    const owner = clueOwner[id];
    if (!owner) {
      problems.push(`keyClues 中的「${id}」不在任何人的口供中`);
      continue;
    }
    if (owner.isCulprit) problems.push(`keyClues 中的「${id}」来自凶手，玩家无法获得`);
  }
  if (!kc.some((id) => liarTrueClues.has(id))) {
    problems.push('keyClues 至少要有 1 条来自说谎者的真话（须先用物证击破他才能获得）');
  }

  return problems;
}

/**
 * 生成一个通过校验的案件（失败自动重试，重试时把上次的问题反馈给模型）。
 * @param {string} genreId
 * @returns {Promise<object>} 归一化后的案件真相
 */
async function generateCase(genreId) {
  const genre = getGenre(genreId);
  if (!genre) throw new Error(`未知案件题材：${genreId}`);

  let problems = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    console.log(`[debug] 案件生成：题材=${genre.id} 第 ${i + 1}/${MAX_ATTEMPTS} 次`);
    const text = await chat(
      [
        { role: 'system', content: buildGenPrompt(genre, problems) },
        { role: 'user', content: `请设计一个「${genre.name}」题材的案件。` },
      ],
      { temperature: 0.9, maxTokens: 4096 },
    );

    const raw = parseActionJson(text);
    if (!raw) {
      problems = ['上一次输出不是合法 JSON 对象，请只输出一个 JSON 对象，不要任何解释或代码块标记'];
      console.log('[debug] 案件生成：输出非 JSON，重试');
      continue;
    }

    const c = normalizeCase(raw, genre);
    problems = validateCase(c);
    if (!problems.length) {
      console.log('[debug] 案件生成：通过结构校验');
      return c;
    }
    console.log('[debug] 案件生成：校验未通过 →', problems.join(' / '));
  }

  throw new Error(`案件生成失败（连续 ${MAX_ATTEMPTS} 次未通过结构校验）：${problems.join('；')}`);
}

module.exports = { listGenres, getGenre, generateCase, normalizeCase, validateCase, GENRES };