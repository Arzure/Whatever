/* ============================================================
 * 撤离协议 · 局外仓库 / 商店 / 出击配置
 * 仓库：撤离带出的物资实体化存储，可变卖为金币
 * 商店：金币购买武器/护甲/扩容/医疗包
 * 出击配置：从仓库选择随身携带的消耗品（医疗包）
 * localStorage 持久化
 * ============================================================ */

const KEY = 'duckov_stash'

// 物资图鉴（icon 决定 CSS 绘制的图标样式）
export const ITEM_DEFS = {
  ram: { name: '内存条', value: 40, color: '#22d3ee', icon: 'ram' },
  disk: { name: '机械硬盘', value: 80, color: '#94a3b8', icon: 'disk' },
  gpu: { name: 'GPU 显卡', value: 220, color: '#4ade80', icon: 'gpu' },
  core: { name: '量子核心', value: 500, color: '#fde047', icon: 'core' },
  medkit: { name: '纳米医疗包', value: 60, color: '#f87171', icon: 'medkit', consumable: true }
}

// 商店目录
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
  ],
  supplies: [
    { id: 'medkit', name: '纳米医疗包', desc: '局内按 H 恢复 50 HP', price: 80 }
  ]
}

export function loadStash() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s) {
      if (!Array.isArray(s.items)) s.items = []
      if (!s.loadout) s.loadout = { weapons: ['pistol'], armor: null, medkits: 0 }
      if (!Array.isArray(s.loadout.weapons) || !s.loadout.weapons.length) s.loadout.weapons = ['pistol']
      return s
    }
  } catch (e) { /* 忽略 */ }
  return { coins: 0, items: [], weapons: ['pistol'], armor: null, bagLv: 0, bestValue: 0, raids: 0, extracts: 0, loadout: { weapons: ['pistol'], armor: null, medkits: 0 } }
}

export function saveStash(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (e) { /* 忽略 */ }
}

// 撤离成功：背包物资实体化入仓 + 未用医疗包回收
export function bankStash(s, bag, leftoverMedkits) {
  for (const it of bag) {
    s.items.push({ id: it.id, name: it.name, value: it.value, color: it.color, size: it.size, kind: it.kind || 'loot' })
  }
  for (let i = 0; i < (leftoverMedkits || 0); i++) {
    s.items.push({ id: 'medkit', ...ITEM_DEFS.medkit, kind: 'supply' })
  }
  s.raids += 1
  s.extracts += 1
  const v = bag.reduce((a, b) => a + b.value, 0)
  if (v > s.bestValue) s.bestValue = v
  saveStash(s)
}

// 死亡结算：只计次数（携带物资掉落封锁区）
export function failStash(s) {
  s.raids += 1
  saveStash(s)
}

// 变卖单件物资（仅战利品类；武器/防具/道具等可用物品不可变卖）
export function sellItem(s, idx) {
  const it = s.items[idx]
  if (!it) return { ok: false, msg: '无效物资' }
  if (it.kind === 'supply' || it.usable) return { ok: false, msg: it.name + '是可用道具，不可变卖' }
  s.coins += it.value
  s.items.splice(idx, 1)
  saveStash(s)
  return { ok: true, msg: '出售 ' + it.name + ' +' + it.value + ' 金币' }
}

// 一键变卖全部战利品（保留可用道具）
export function sellAllLoot(s) {
  let total = 0
  s.items = s.items.filter(it => {
    if (it.kind === 'supply' || it.usable) return true
    total += it.value
    return false
  })
  s.coins += total
  saveStash(s)
  return { ok: true, msg: '清仓出售 +' + total + ' 金币' }
}

export function buy(s, kind, id) {
  const list = SHOP[kind]
  if (!list) return { ok: false, msg: '无效商品' }
  const item = list.find(i => i.id === id)
  if (!item) return { ok: false, msg: '无效商品' }
  if (kind === 'weapons' && s.weapons.includes(id)) return { ok: false, msg: '已拥有' }
  if (kind === 'armors' && s.armor === id) return { ok: false, msg: '已装备' }
  if (kind === 'upgrades') {
    const lv = ['bag1', 'bag2', 'bag3'].indexOf(id) + 1
    if (s.bagLv >= lv) return { ok: false, msg: '已购买' }
  }
  if (s.coins < item.price) return { ok: false, msg: '金币不足' }
  s.coins -= item.price
  if (kind === 'weapons') s.weapons.push(id)
  if (kind === 'armors') s.armor = id
  if (kind === 'upgrades') s.bagLv = Math.max(s.bagLv, ['bag1', 'bag2', 'bag3'].indexOf(id) + 1)
  if (kind === 'supplies') s.items.push({ id: 'medkit', ...ITEM_DEFS.medkit, kind: 'supply' })
  saveStash(s)
  return { ok: true, msg: '已购买 ' + item.name }
}

// 仓库中医疗包数量
export function medkitCount(s) {
  return s.items.filter(it => it.id === 'medkit').length
}

// 出击后从仓库移除已携带的医疗包
export function consumeMedkits(s, n) {
  let left = n
  for (let i = s.items.length - 1; i >= 0 && left > 0; i--) {
    if (s.items[i].id === 'medkit') { s.items.splice(i, 1); left-- }
  }
  saveStash(s)
}

export function bagCapacity(s) {
  return 10 + (s.bagLv || 0) * 4
}

export function armorMul(s) {
  if (s.armor === 'light') return 0.75
  if (s.armor === 'heavy') return 0.55
  return 1
}
