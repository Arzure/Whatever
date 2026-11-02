/* ============================================================
 * 撤离协议 · 局外仓库 / 商店 / 出击配置
 * 仓库：撤离带出的物资实体化存储，可变卖为金币
 * 商店：金币购买武器/护甲/扩容/医疗包
 * 出击配置：从仓库选择随身携带的消耗品（医疗包）
 * localStorage 持久化
 * ============================================================ */

import { PARTS, PART_CATS, TIER_NAMES } from './game.js'

const KEY = 'duckov_stash'

// 物资图鉴（icon 决定 CSS 绘制的图标样式）
export const ITEM_DEFS = {
  ram: { name: '内存条', value: 40, color: '#22d3ee', icon: 'ram' },
  disk: { name: '机械硬盘', value: 80, color: '#94a3b8', icon: 'disk' },
  gpu: { name: 'GPU 显卡', value: 220, color: '#4ade80', icon: 'gpu' },
  core: { name: '量子核心', value: 500, color: '#fde047', icon: 'core' },
  medkit: { name: '纳米医疗包', value: 60, color: '#f87171', icon: 'medkit', consumable: true },
  stim: { name: '肾上腺素注射器', value: 90, color: '#a3e635', icon: 'stim', consumable: true },
  emp: { name: 'EMP 手雷', value: 120, color: '#22d3ee', icon: 'emp', consumable: true }
}

// 商店目录
export const SHOP = {
  weapons: [
    { id: 'smg', name: '散热冲锋枪', desc: '高射速 · 30 发弹匣', price: 300 },
    { id: 'laser', name: '相位激光枪', desc: '高精度速射 · 24 发能量匣', price: 650 },
    { id: 'shotgun', name: '脉冲霰弹', desc: '近距离爆发 · 6 发弹匣', price: 500 },
    { id: 'rocket', name: '火箭发射器', desc: '范围爆炸 80 伤害 · 3 发弹匣', price: 1400 },
    { id: 'railgun', name: '轨道炮', desc: '单发 90 伤害 · 慢速重炮', price: 1800 }
  ],
  armors: [
    { id: 'light', name: '轻量防火板', desc: '受到伤害 -25%', price: 250 },
    { id: 'heavy', name: '重型机柜装甲', desc: '受到伤害 -45%', price: 850 }
  ],
  upgrades: [
    { id: 'bag1', name: '扩容背包 I', desc: '背包容量 +4', price: 200 },
    { id: 'bag2', name: '扩容背包 II', desc: '背包容量 +4', price: 450 },
    { id: 'bag3', name: '扩容背包 III', desc: '背包容量 +4', price: 950 },
    { id: 'safebox1', name: '安全箱扩容 I', desc: '安全箱容量 +2（死亡保留）', price: 600 },
    { id: 'safebox2', name: '安全箱扩容 II', desc: '安全箱容量 +2（死亡保留）', price: 1200 }
  ],
  supplies: [
    { id: 'medkit', name: '纳米医疗包', desc: '局内按 H 恢复 50 HP', price: 80 },
    { id: 'stim', name: '肾上腺素注射器', desc: '局内按 G 移速+35% 持续 5 秒', price: 120 },
    { id: 'emp', name: 'EMP 手雷', desc: '局内按 Q 瘫痪周围敌人 3 秒', price: 180 }
  ]
}

// 旧战利品 → 新配件体系迁移映射
const LEGACY_MAP = {
  ram: 'ram-0',
  disk: 'ssd-1',
  gpu: 'gpu-4060',
  core: 'cpu-a2'
}

// 将旧版战利品条目迁移为新配件字段
function migrateLegacy(items) {
  if (!Array.isArray(items)) return
  for (const it of items) {
    const nid = LEGACY_MAP[it.id]
    if (!nid) continue
    const p = PARTS.find(pt => pt.id === nid)
    if (!p) continue
    Object.assign(it, { id: p.id, name: p.name, value: p.value, color: p.color, size: p.size, cat: p.cat, tier: p.tier, platform: p.platform || null })
  }
}

export function loadStash() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s) {
      if (!Array.isArray(s.items)) s.items = []
      if (!Array.isArray(s.safebox)) s.safebox = []
      migrateLegacy(s.items)
      migrateLegacy(s.safebox)
      if (!s.loadout) s.loadout = { weapons: ['pistol'], armor: null, items: [] }
      if (!Array.isArray(s.loadout.weapons) || !s.loadout.weapons.length) s.loadout.weapons = ['pistol']
      if (!Array.isArray(s.loadout.items)) s.loadout.items = []
      return s
    }
  } catch (e) { /* 忽略 */ }
  return { coins: 0, items: [], safebox: [], weapons: ['pistol'], armor: null, bagLv: 0, safeboxLv: 0, bestValue: 0, raids: 0, extracts: 0, loadout: { weapons: ['pistol'], armor: null, items: [] } }
}

// 仓库物品放入出击配置（仅可用道具：医疗包等；战利品不可携带）
export function moveItemToLoadout(s, idx) {
  const it = s.items[idx]
  if (!it) return { ok: false, msg: '无效物品' }
  if (it.kind !== 'supply' && !it.usable) return { ok: false, msg: it.name + '是战利品，不可携带出击' }
  s.items.splice(idx, 1)
  s.loadout.items.push(it)
  saveStash(s)
  return { ok: true, msg: '已放入出击配置：' + it.name }
}

// 出击配置物品放回仓库
export function moveItemBack(s, idx) {
  const it = s.loadout.items[idx]
  if (!it) return { ok: false, msg: '无效物品' }
  s.loadout.items.splice(idx, 1)
  s.items.push(it)
  saveStash(s)
  return { ok: true, msg: '已放回仓库：' + it.name }
}

export function saveStash(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (e) { /* 忽略 */ }
}

// 撤离成功：背包物资实体化入仓 + 未用医疗包回收
export function bankStash(s, bag, leftoverMedkits) {
  for (const it of bag) {
    s.items.push({ id: it.id, name: it.name, value: it.value, color: it.color, size: it.size, kind: it.kind || 'loot', cat: it.cat, tier: it.tier, platform: it.platform || null })
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

// 变卖单件物资（任何物品都可单件变卖）
export function sellItem(s, idx) {
  const it = s.items[idx]
  if (!it) return { ok: false, msg: '无效物资' }
  s.coins += it.value
  s.items.splice(idx, 1)
  saveStash(s)
  return { ok: true, msg: '出售 ' + it.name + ' +' + it.value + ' 金币' }
}

// 一键变卖全部战利品（忽略武器/防具/道具等可用物品）
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
    if (lv > 0 && s.bagLv >= lv) return { ok: false, msg: '已购买' }
    const slv = ['safebox1', 'safebox2'].indexOf(id) + 1
    if (slv > 0 && (s.safeboxLv || 0) >= slv) return { ok: false, msg: '已购买' }
  }
  if (s.coins < item.price) return { ok: false, msg: '金币不足' }
  s.coins -= item.price
  if (kind === 'weapons') s.weapons.push(id)
  if (kind === 'armors') s.armor = id
  if (kind === 'upgrades') {
    s.bagLv = Math.max(s.bagLv, ['bag1', 'bag2', 'bag3'].indexOf(id) + 1)
    s.safeboxLv = Math.max(s.safeboxLv || 0, ['safebox1', 'safebox2'].indexOf(id) + 1)
  }
  if (kind === 'supplies') s.items.push({ id, ...ITEM_DEFS[id], kind: 'supply' })
  saveStash(s)
  return { ok: true, msg: '已购买 ' + item.name }
}

// 仓库中医疗包数量
export function medkitCount(s) {
  return s.items.filter(it => it.id === 'medkit').length
}

// 出击配置中医疗包数量
export function loadoutMedkitCount(s) {
  return s.loadout.items.filter(it => it.id === 'medkit').length
}

// 出击后从出击配置移除已携带的医疗包
export function consumeMedkits(s, n) {
  let left = n
  for (let i = s.loadout.items.length - 1; i >= 0 && left > 0; i--) {
    if (s.loadout.items[i].id === 'medkit') { s.loadout.items.splice(i, 1); left-- }
  }
  saveStash(s)
}

// 出击后从出击配置移除已携带的指定消耗品（stim/emp 等）
export function consumeSupplies(s, id, n) {
  let left = n
  for (let i = s.loadout.items.length - 1; i >= 0 && left > 0; i--) {
    if (s.loadout.items[i].id === id) { s.loadout.items.splice(i, 1); left-- }
  }
  saveStash(s)
}

export function bagCapacity(s) {
  return 20 + (s.bagLv || 0) * 4
}

// 安全箱容量：基础 4 格 + 扩容
export function safeboxCapacity(s) {
  return 4 + (s.safeboxLv || 0) * 2
}

// 仓库物品放入安全箱（死亡保留）
export function moveToSafebox(s, idx) {
  const it = s.items[idx]
  if (!it) return { ok: false, msg: '无效物品' }
  if (s.safebox.length >= safeboxCapacity(s)) return { ok: false, msg: '安全箱已满' }
  s.items.splice(idx, 1)
  s.safebox.push(it)
  saveStash(s)
  return { ok: true, msg: '已放入安全箱：' + it.name }
}

// 安全箱物品放回仓库
export function moveFromSafebox(s, idx) {
  const it = s.safebox[idx]
  if (!it) return { ok: false, msg: '无效物品' }
  s.safebox.splice(idx, 1)
  s.items.push(it)
  saveStash(s)
  return { ok: true, msg: '已取出：' + it.name }
}

export function armorMul(s) {
  if (s.armor === 'light') return 0.75
  if (s.armor === 'heavy') return 0.55
  return 1
}

// ============================================================
// 合成整机系统：仓库凑齐同档 8 大部件且 CPU 与主板平台一致
// 合成价 = 散件总价 × 档位倍率（低端/中端 1.3、高端 1.5、至尊 2.0）
// ============================================================
export const PC_MULT = [1.3, 1.3, 1.5, 2.0]

// 合成预览：各档位配件持有情况与缺口（供 UI 展示）
export function synthPreview(s) {
  const result = []
  for (let tier = 0; tier < 4; tier++) {
    const cats = Object.keys(PART_CATS)
    const have = {}
    for (const cat of cats) have[cat] = s.items.filter(it => it.cat === cat && it.tier === tier).length
    const cpu = s.items.find(it => it.cat === 'cpu' && it.tier === tier)
    const mbOk = cpu ? s.items.some(it => it.cat === 'mb' && it.tier === tier && (!it.platform || !cpu.platform || it.platform === cpu.platform)) : false
    const missing = cats.filter(c => !have[c] || (c === 'mb' && !mbOk))
    result.push({ tier, name: TIER_NAMES[tier], have: { ...have }, mbOk, ready: missing.length === 0, missing })
  }
  return result
}

// 合成整机：优先合成可用的最高档位；成功返回整机物品
export function synthesizePC(s) {
  for (let tier = 3; tier >= 0; tier--) {
    const cpuIdx = s.items.findIndex(it => it.cat === 'cpu' && it.tier === tier)
    if (cpuIdx < 0) continue
    const cpu = s.items[cpuIdx]
    const mbIdx = s.items.findIndex(it => it.cat === 'mb' && it.tier === tier && (!it.platform || !cpu.platform || it.platform === cpu.platform))
    if (mbIdx < 0) continue
    const picked = [cpuIdx, mbIdx]
    let ok = true
    for (const cat of ['gpu', 'ram', 'ssd', 'psu', 'case', 'cooler']) {
      const idx = s.items.findIndex((it, i) => it.cat === cat && it.tier === tier && !picked.includes(i))
      if (idx < 0) { ok = false; break }
      picked.push(idx)
    }
    if (!ok) continue
    const parts = picked.map(i => s.items[i])
    const total = parts.reduce((a, b) => a + b.value, 0)
    const value = Math.round(total * PC_MULT[tier])
    const platform = cpu.platform || 'amd'
    const name = TIER_NAMES[tier] + '整机（' + (platform === 'amd' ? 'AMD 平台' : 'Intel 平台') + '）'
    picked.sort((a, b) => b - a).forEach(i => s.items.splice(i, 1))
    const pc = { id: 'pc-' + tier + '-' + platform, name, value, color: tier === 3 ? '#fde047' : '#4ade80', size: 1, kind: 'pc', tier, platform }
    s.items.push(pc)
    saveStash(s)
    return { ok: true, msg: '合成成功：' + name + '（价值 ' + value + ' 金币）', pc }
  }
  return { ok: false, msg: '缺少可合成的同档 8 件套配件（CPU 与主板平台需一致）' }
}
