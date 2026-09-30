const fs = require('fs');
const path = require('path');
const { chat } = require('../llm');
const { parseActionJson } = require('../engine');

const THEMES_DIR = __dirname;

// 支持的数值项 / 物品类别（用于规范化 AI 返回的主题配置）
const STAT_KEYS = ['hp', 'gold', 'exp'];
const ITEM_CATEGORIES = ['weapon', 'armor', 'item'];

/** 列出内置世界观（只返回列表页需要的摘要信息） */
function listThemes() {
  const files = fs.readdirSync(THEMES_DIR).filter((f) => f.endsWith('.json'));
  return files
    .map((f) => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, f), 'utf-8'));
        return { id: t.id, name: t.name, intro: t.intro };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

/** 按 id 读取内置世界观完整配置；id 只允许安全字符，避免路径穿越 */
function getTheme(id) {
  const safe = String(id || '').trim();
  if (!/^[a-z0-9_-]+$/i.test(safe)) return null;
  const p = path.join(THEMES_DIR, `${safe}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return normalizeTheme(JSON.parse(fs.readFileSync(p, 'utf-8')));
  } catch (e) {
    return null;
  }
}

/**
 * 把 AI 返回（或文件读取）的主题对象规范化，保证后续引擎取用安全。
 * 补齐 capabilities / startState，并让 startState.slots 的键与 slots 定义一致。
 */
function normalizeTheme(t) {
  const caps = t.capabilities || {};

  let statSchema = Array.isArray(caps.statSchema)
    ? caps.statSchema.filter((s) => STAT_KEYS.includes(s))
    : [];
  if (!statSchema.includes('hp')) statSchema.unshift('hp');

  const itemCategories = Array.isArray(caps.itemCategories)
    ? caps.itemCategories.filter((c) => ITEM_CATEGORIES.includes(c))
    : [];
  if (!itemCategories.includes('item')) itemCategories.push('item');

  const slots = Array.isArray(caps.slots)
    ? caps.slots
        .filter((s) => s && s.id)
        .map((s) => ({ id: String(s.id), label: String(s.label || s.id) }))
    : [];
  // 有武器/防具类别才会出现对应槽位
  if (!itemCategories.includes('weapon')) removeSlot(slots, 'weapon');
  if (!itemCategories.includes('armor')) removeSlot(slots, 'armor');

  const ss = t.startState || {};
  const startState = {
    hp: Number(ss.hp) || 100,
    maxHp: Number(ss.maxHp) || Number(ss.hp) || 100,
    gold: Number(ss.gold) || 0,
    level: Number(ss.level) || 1,
    exp: Number(ss.exp) || 0,
    inventory: Array.isArray(ss.inventory) ? ss.inventory.map(String) : [],
    slots: {},
  };
  const ssSlots = ss.slots && typeof ss.slots === 'object' ? ss.slots : {};
  for (const s of slots) startState.slots[s.id] = ssSlots[s.id] || null;

  return {
    id: String(t.id || 'custom').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'custom',
    name: String(t.name || '未命名世界').slice(0, 40),
    intro: String(t.intro || '').slice(0, 600),
    capabilities: { hasCombat: !!caps.hasCombat, statSchema, itemCategories, slots },
    startState,
    gmGuidelines: String(t.gmGuidelines || '').slice(0, 1000),
  };
}

function removeSlot(slots, id) {
  const i = slots.findIndex((s) => s.id === id);
  if (i !== -1) slots.splice(i, 1);
}

/**
 * 把玩家粘贴的纯文本世界观，交给 AI 结构化成 Theme 配置。
 * @param {string} text 世界观描述文本
 * @returns {Promise<object>} 规范化后的主题配置
 */
async function parseThemeFromText(text) {
  const src = String(text || '').trim();
  if (!src) throw new Error('世界观文本不能为空');

  const system = `你是一个文字冒险游戏的世界观配置生成器。用户会给出一段世界观设定文本，你需要把它转换成如下 JSON 结构，只输出这个 JSON 对象，不要输出任何解释或代码块标记：
{"id":"英文小写短标识","name":"世界名称","intro":"80~150字的世界观开场叙述，第二人称，用于开场介绍","capabilities":{"hasCombat":true,"statSchema":["hp","gold","exp"],"itemCategories":["weapon","armor","item"],"slots":[{"id":"weapon","label":"武器"},{"id":"armor","label":"防具"}]},"startState":{"hp":100,"maxHp":100,"gold":10,"level":1,"exp":0,"inventory":["干粮 x2"],"slots":{"weapon":"武器·旧铁剑[普通]","armor":"防具·皮甲[普通]"}},"gmGuidelines":"该世界特有的叙事约束，没有则空字符串"}

规则：
- 若世界观适合战斗、需要武器防具：hasCombat=true，itemCategories 含 "weapon","armor","item"，slots 含武器与防具两槽。
- 若世界观没有战斗或不需要武器防具（如现代、日常、解谜、经营）：hasCombat=false，itemCategories 只含 "item"，slots 为 []，startState.slots 为 {}。
- statSchema 至少包含 "hp"；若适合经济与成长可加入 "gold","exp"。值为 "hp"/"gold"/"exp" 的数组。
- startState.slots 的键必须与 capabilities.slots 的 id 完全一致；没有装备则为 {}。
- inventory 为字符串数组，如 "手电筒"、"面包 x2"；数量用 " x数字" 后缀。
- 物品若有武器/防具，命名格式为「武器·名称[品质]」「防具·名称[品质]」，品质取 普通/优秀/稀有/史诗/传说；道具无前缀。
- gmGuidelines 写 1~3 条该世界特有的叙事要点（如时代背景、禁忌、语气）。`;

  const content = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: src.slice(0, 4000) },
    ],
    { temperature: 0.6, maxTokens: 2048 }
  );

  const obj = parseActionJson(content);
  if (!obj) throw new Error('AI 未能把该文本解析为世界观结构，请调整内容后重试');
  return normalizeTheme(obj);
}

module.exports = { listThemes, getTheme, parseThemeFromText, normalizeTheme };
