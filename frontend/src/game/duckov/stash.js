/* ============================================================
 * 逃离鹅科夫 · 局外仓库与商店
 * 撤离成功 → 物资价值折算金币；金币购买武器/护甲/背包扩容
 * 装备带入下一局（搜打撤的局外成长循环）；localStorage 持久化
 * ============================================================ */

const KEY = 'duckov_stash'

// 可购买装备目录
export const SHOP = {
  weapons: [
    { id: 'smg', name: '散热冲锋枪', desc: '高射速 · 30 发弹匣', price: 300 },
    { id: 'shotgun', name: '脉冲霰弹', desc: '近距离爆发 · 6 发弹匣', price: 500 },
    { id: 'railgun', name: '轨道炮', desc: '单发 90 伤害 · 慢速重炮', price: 1500 }
  ],
  armors: [
    { id: 'light', name: '轻量防火板', desc: '受到伤害 -25%', price: 250 },
    { id: 'heavy', name: '重型机柜装甲', desc: '受到伤害 -45%', price: 700 }
  ],
  upgrades: [
    { id: 'bag1', name: '扩容背包 I', desc: '背包容量 +4', price: 200 },
    { id: 'bag2', name: '扩容背包 II', desc: '背包容量 +4', price: 450 },
    { id: 'bag3', name: '扩容背包 III', desc: '背包容量 +4', price: 800 }
  ]
}

// 轨道炮属性（game.js WEAPONS 之外的局外武器）
export const RAILGUN = { name: '轨道炮', dmg: 90, cd: 1.1, speed: 760, spread: 0, mag: 5, reload: 2.0, noise: 420, color: '#c084fc' }

export function loadStash() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s) return s
  } catch (e) { /* 忽略 */ }
  return { coins: 0, weapons: ['pistol'], armor: null, bagLv: 0, bestValue: 0, raids: 0, extracts: 0 }
}

export function saveStash(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (e) { /* 忽略 */ }
}

// 撤离成功结算：物资价值折算金币
export function bankStash(s, lootValue) {
  s.coins += lootValue
  s.raids += 1
  s.extracts += 1
  if (lootValue > s.bestValue) s.bestValue = lootValue
  saveStash(s)
}

// 死亡结算：只计次数
export function failStash(s) {
  s.raids += 1
  saveStash(s)
}

export function buy(s, kind, id) {
  const list = SHOP[kind]
  if (!list) return { ok: false, msg: '无效商品' }
  const item = list.find(i => i.id === id)
  if (!item) return { ok: false, msg: '无效商品' }
  if (kind === 'weapons' && s.weapons.includes(id)) return { ok: false, msg: '已拥有' }
  if (kind === 'armors' && s.armor === id) return { ok: false, msg: '已装备' }
  if (kind === 'upgrades') {
    const order = ['bag1', 'bag2', 'bag3']
    if (order.indexOf(id) <= order.indexOf(['bag1', 'bag2', 'bag3'][s.bagLv]) && s.bagLv > order.indexOf(id)) return { ok: false, msg: '已购买' }
  }
  if (s.coins < item.price) return { ok: false, msg: '金币不足' }
  s.coins -= item.price
  if (kind === 'weapons') s.weapons.push(id)
  if (kind === 'armors') s.armor = id
  if (kind === 'upgrades') s.bagLv = Math.max(s.bagLv, ['bag1', 'bag2', 'bag3'].indexOf(id) + 1)
  saveStash(s)
  return { ok: true, msg: '已购买 ' + item.name }
}

// 背包容量：基础 10 + 每级 +4
export function bagCapacity(s) {
  return 10 + (s.bagLv || 0) * 4
}

// 护甲减伤系数
export function armorMul(s) {
  if (s.armor === 'light') return 0.75
  if (s.armor === 'heavy') return 0.55
  return 1
}
