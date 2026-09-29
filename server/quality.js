/**
 * 装备/物品品质系统。
 *
 * 物品分为三类：
 * - 武器（weapon）：带类型前缀「武器·」与品质标记「[品质]」，如 武器·短刃[稀有]
 * - 防具（armor）：带类型前缀「防具·」与品质标记「[品质]」，如 防具·皮甲[优秀]
 * - 道具（item）：无前缀无品质标记，如 干粮 x2、治疗药水
 *
 * 武器和防具品质越高威力/防护越强；道具不做品质渲染。
 */

// 品质定义（顺序即稀有度，越靠后越高阶）
const QUALITIES = [
  { key: '普通', color: '#9aa7b4', atk: 0, desc: '随处可见的普通货色' },
  { key: '优秀', color: '#4dabf7', atk: 10, desc: '做工精良，比普通货色更顺手' },
  { key: '稀有', color: '#b197fc', atk: 25, desc: '难得一见的精品，价值不菲' },
  { key: '史诗', color: '#fcc419', atk: 45, desc: '传说中才有的神兵利器' },
  { key: '传说', color: '#ff6b6b', atk: 70, desc: '足以载入史诗的究极之物' },
];

const QUALITY_MAP = new Map(QUALITIES.map((q, i) => [q.key, { ...q, rank: i }]));

// 物品类型前缀
const PREFIX_WEAPON = '武器·';
const PREFIX_ARMOR = '防具·';

/**
 * 解析物品名，拆出类型、纯名称、品质。
 * @param {string} itemName 如 "武器·短刃[稀有]"、"干粮 x2"
 * @returns {{ type: 'weapon'|'armor'|'item', name: string, quality: object|null, raw: string }}
 */
function parseItem(itemName) {
  const raw = String(itemName).trim();
  let type = 'item';
  let rest = raw;

  if (rest.startsWith(PREFIX_WEAPON)) {
    type = 'weapon';
    rest = rest.slice(PREFIX_WEAPON.length);
  } else if (rest.startsWith(PREFIX_ARMOR)) {
    type = 'armor';
    rest = rest.slice(PREFIX_ARMOR.length);
  }

  const match = rest.match(/^(.*?)\[([^\]]+)\]$/);
  const name = match ? match[1].trim() : rest.trim();
  const quality = match ? QUALITY_MAP.get(match[2]) || null : null;

  return { type, name, quality, raw };
}

/**
 * 构造标准化的完整物品名（含类型前缀与品质标记）。
 * 供后端存储与 AI 参考使用。
 */
function buildItemName(type, name, qualityKey) {
  const prefix = type === 'weapon' ? PREFIX_WEAPON : type === 'armor' ? PREFIX_ARMOR : '';
  const q = qualityKey ? `[${qualityKey}]` : '';
  return `${prefix}${name}${q}`;
}

/**
 * 对比两个同类型装备的战力（品质等级优先）。返回 >0 表示 a 强于 b。
 */
function comparePower(itemA, itemB) {
  const a = parseItem(itemA);
  const b = parseItem(itemB);
  const aRank = a.quality ? a.quality.rank : -1;
  const bRank = b.quality ? b.quality.rank : -1;
  return aRank - bRank;
}

/**
 * 渲染玩家面板中的装备文本：
 * - 武器槽 / 防具槽：显示名称与品质
 * - 背包：只列道具（武器/防具不占背包位）
 */
function renderEquipment(weapon, armor) {
  return [
    `- 武器：${weapon || '徒手'}`,
    `- 防具：${armor || '无'}`,
  ].join('\n');
}

/** 渲染道具背包列表（不含武器/防具） */
function renderInventory(inventory) {
  if (!inventory.length) return '（空空如也）';
  return inventory.join('、');
}

/** 品质 key 集合（供前端与后端共用定义） */
const QUALITY_KEYS = QUALITIES.map((q) => q.key);

module.exports = {
  QUALITIES,
  QUALITY_KEYS,
  parseItem,
  buildItemName,
  comparePower,
  renderEquipment,
  renderInventory,
};
