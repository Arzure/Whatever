/* ============================================================
 * 割草幸存者：运维之夜 —— 核心游戏模块
 * 纯 Canvas 2D / 零依赖 / 数值表驱动
 * 20 分钟一局：15min 内核恐慌 Boss，20min 数据毁灭者终局
 * ============================================================ */

import { sound } from './audio.js'

// ---------- 数值表：武器 ----------

export const WEAPONS = {
  firewall: {
    name: '防火墙', color: '#22d3ee', type: 'orbit',
    desc: '旋转的弧形防护墙，撞击伤害并击退故障',
    dmg: 10, count: 2, radius: 95, size: 14, spin: 2.4, arc: 0.9,
    maxLv: 5, up: ['+1 墙段', '+外层防护环', '格挡冷却 -1s', '第三层防护环']
  },
  cannon: {
    name: '主炮', color: '#e0f2fe', type: 'auto',
    desc: '朝鼠标方向自动连射补丁弹',
    dmg: 12, cd: 0.5, speed: 560, pierce: 1,
    maxLv: 5, up: ['射速 +30%', '伤害 +40%', '+1 穿透', '双联装：两发齐射']
  },
  turret: {
    name: '副机枪', color: '#5eead4', type: 'turret',
    desc: '环绕玩家的自动炮塔，锁定最近故障持续扫射',
    dmg: 3, cd: 0.3, speed: 520, pierce: 1,
    maxLv: 5, up: ['射速 +40%', '伤害 +50%', '+1 座炮塔', '子弹可穿透']
  },
  patch: {
    name: '热修复', color: '#a78bfa', type: 'shot',
    desc: '自动朝最近故障发射补丁',
    dmg: 12, count: 1, speed: 420, cd: 1.1, pierce: 1,
    maxLv: 5, up: ['+1 补丁', '冷却 -15%', '+伤害与穿透', '+1 补丁']
  },
  log: {
    name: '日志洪流', color: '#fbbf24', type: 'laser',
    desc: '周期性扫出穿透光束',
    dmg: 6, cd: 2.6, width: 10, len: 520,
    maxLv: 5, up: ['+伤害', '冷却 -15%', '+宽度', '+伤害与长度']
  },
  cron: {
    name: '定时任务', color: '#f472b6', type: 'rain',
    desc: '随机位置降下计划打击',
    dmg: 18, count: 3, cd: 3.2, radius: 46,
    maxLv: 5, up: ['+1 打击', '+伤害', '冷却 -15%', '+1 打击与范围']
  },
  grep: {
    name: '深度搜索', color: '#34d399', type: 'homing',
    desc: '追踪目标的搜索弹',
    dmg: 9, count: 2, speed: 300, cd: 1.8,
    maxLv: 5, up: ['+1 搜索弹', '+伤害', '冷却 -15%', '+1 搜索弹']
  },
  ping: {
    name: '心跳脉冲', color: '#60a5fa', type: 'nova',
    desc: '以自身为中心的环形脉冲',
    dmg: 14, cd: 2.4, radius: 130,
    maxLv: 5, up: ['+半径', '+伤害', '冷却 -15%', '+伤害与半径']
  },
  cache: {
    name: '缓存冲击', color: '#fb7185', type: 'wave',
    desc: '击杀时概率释放冲击波',
    dmg: 20, chance: 0.22, radius: 100,
    maxLv: 5, up: ['+触发概率', '+伤害', '+半径', '+概率与伤害']
  },
  backup: {
    name: '备份分身', color: '#e879f9', type: 'clone',
    desc: '自动作战的克隆体；致命伤害时牺牲自己替你恢复',
    dmg: 5, cd: 0.8,
    maxLv: 5, up: ['+1 分身', '伤害+35%', '+1 分身', '射速+40%']
  }
}

// ---------- 数值表：武器进化（Lv5 后可进化为终极形态） ----------
export const EVOLUTIONS = {
  cannon: { name: '轨道炮', color: '#f0abfc', desc: '伤害×2.2 射速×1.6，弹体巨大化', dmgMul: 2.2, cdMul: 0.625, big: true },
  firewall: { name: '防火墙集群', color: '#38bdf8', desc: '伤害×2.2，墙段辉光炽烈', dmgMul: 2.2, cdMul: 1 },
  turret: { name: '激光哨戒阵列', color: '#2dd4bf', desc: '伤害×2.2 射速×1.6', dmgMul: 2.2, cdMul: 0.625 },
  patch: { name: '热修复协议', color: '#c4b5fd', desc: '伤害×2.2 射速×1.4', dmgMul: 2.2, cdMul: 0.7 },
  log: { name: '日志海啸', color: '#fcd34d', desc: '伤害×2.2 光束更宽', dmgMul: 2.2, cdMul: 1 },
  cron: { name: '定时风暴', color: '#f9a8d4', desc: '伤害×2.2 冷却-30%', dmgMul: 2.2, cdMul: 0.7 },
  grep: { name: '全局递归搜索', color: '#6ee7b7', desc: '伤害×2.2 射速×1.4', dmgMul: 2.2, cdMul: 0.7 },
  ping: { name: '心跳风暴', color: '#93c5fd', desc: '伤害×2.2 冷却-30%', dmgMul: 2.2, cdMul: 0.7 },
  cache: { name: '缓存雪崩', color: '#fda4af', desc: '触发概率与伤害大增', dmgMul: 2.2, cdMul: 1 },
  backup: { name: '异地多活', color: '#f0abfc', desc: '伤害×2.2 射速×1.6，备份恢复冷却减半', dmgMul: 2.2, cdMul: 0.625 }
}

// ---------- 数值表：角色（不同初始武器与特性） ----------
export const CHARACTERS = {
  ops: { name: '运维工程师', color: '#22d3ee', desc: '防火墙+主炮开局，护甲+8%', weapons: ['firewall', 'cannon'], armor: 0.08 },
  dba: { name: 'DBA', color: '#a78bfa', desc: '热修复+主炮开局，伤害+10%', weapons: ['patch', 'cannon'], dmgMul: 1.10 },
  fe: { name: '前端', color: '#f472b6', desc: '副机枪+主炮开局，移速+12%', weapons: ['turret', 'cannon'], speed: 1.12 }
}
// ---------- 数值表：被动 ----------

export const PASSIVES = {
  coffee: { name: '无限咖啡', color: '#d4a373', desc: '移动速度 +12%/级', maxLv: 3, stat: 'speed', per: 0.12 },
  ram: { name: '内存扩容', color: '#94a3b8', desc: '最大生命 +25/级', maxLv: 3, stat: 'maxHp', per: 25 },
  cpu: { name: 'CPU 超频', color: '#38bdf8', desc: '武器冷却 -10%/级', maxLv: 3, stat: 'cdr', per: 0.10 },
  bandwidth: { name: '带宽扩容', color: '#818cf8', desc: '拾取范围 +30%/级', maxLv: 3, stat: 'pickup', per: 0.30 },
  armor: { name: '运维手册', color: '#a3a3a3', desc: '受到伤害 -8%/级', maxLv: 3, stat: 'armor', per: 0.08 },
  luck: { name: '幸运字符', color: '#fde047', desc: '暴击率 +8%/级', maxLv: 3, stat: 'crit', per: 0.08 },
  regen: { name: '自愈脚本', color: '#4ade80', desc: '每秒回复 0.5/级', maxLv: 3, stat: 'regen', per: 0.5 },
  power: { name: '权限提升', color: '#f97316', desc: '全部伤害 +10%/级', maxLv: 3, stat: 'dmg', per: 0.10 }
}

// ---------- 数值表：敌人 ----------

export const ENEMIES = {
  bug: { name: '小虫', color: '#ef4444', hp: 10, dmg: 6, speed: 62, r: 9, xp: 1, shape: 'tri' },
  zombie: { name: '僵尸进程', color: '#84cc16', hp: 26, dmg: 10, speed: 44, r: 12, xp: 2, shape: 'square' },
  leak: { name: '内存泄漏', color: '#06b6d4', hp: 16, dmg: 8, speed: 74, r: 10, xp: 2, shape: 'hex' },
  ddos: { name: 'DDoS 洪流', color: '#f59e0b', hp: 14, dmg: 12, speed: 108, r: 8, xp: 3, shape: 'diamond' },
  worm: { name: '蠕虫', color: '#e879f9', hp: 40, dmg: 12, speed: 52, r: 13, xp: 4, shape: 'pent' },
  spam: { name: '垃圾流量', color: '#f472b6', hp: 60, dmg: 14, speed: 38, r: 15, xp: 5, shape: 'square' },
  splitter: { name: '分裂进程', color: '#c084fc', hp: 36, dmg: 10, speed: 46, r: 14, xp: 3, shape: 'square' },
  sniper: { name: '远程注入', color: '#22d3ee', hp: 22, dmg: 8, speed: 40, r: 10, xp: 3, shape: 'diamond' },
  flanker: { name: '侧翼包抄', color: '#a3e635', hp: 28, dmg: 10, speed: 78, r: 11, xp: 3, shape: 'tri' },
  kiter: { name: '风筝射手', color: '#38bdf8', hp: 24, dmg: 9, speed: 66, r: 10, xp: 4, shape: 'diamond' },
  charger: { name: '暴力破解', color: '#fb923c', hp: 30, dmg: 16, speed: 50, r: 11, xp: 4, shape: 'tri' },
  bomber: { name: '自爆程序', color: '#f87171', hp: 18, dmg: 26, speed: 88, r: 9, xp: 3, shape: 'pent' },
  healer: { name: '修复进程', color: '#4ade80', hp: 34, dmg: 6, speed: 36, r: 12, xp: 5, shape: 'hex' },
  tank: { name: '堡垒进程', color: '#94a3b8', hp: 130, dmg: 14, speed: 22, r: 17, xp: 6, shape: 'square' },
  kernel_panic: { name: '内核恐慌', color: '#dc2626', hp: 2600, dmg: 30, speed: 40, r: 34, xp: 120, shape: 'boss', boss: true },
  memory_leak: { name: '内存泄漏巨兽', color: '#06b6d4', hp: 900, dmg: 22, speed: 55, r: 26, xp: 60, shape: 'boss', boss: true },
  data_destroyer: { name: '数据毁灭者', color: '#7c3aed', hp: 5200, dmg: 40, speed: 46, r: 40, xp: 300, shape: 'boss', boss: true }
}

// ---------- 数值表：波次（t 为秒） ----------

export const WAVES = [
  { t: 0, interval: 0.9, types: { bug: 2 } },
  { t: 40, interval: 0.8, types: { bug: 3 } },
  { t: 90, interval: 0.75, types: { bug: 3, zombie: 1 } },
  { t: 150, interval: 0.7, types: { bug: 2, zombie: 3 } },
  { t: 210, interval: 0.65, types: { zombie: 3, leak: 2 } },
  { t: 280, interval: 0.6, types: { bug: 2, leak: 3 }, boss: 'memory_leak' },
  { t: 350, interval: 0.55, types: { leak: 3, ddos: 2 } },
  { t: 430, interval: 0.5, types: { zombie: 3, ddos: 3 } },
  { t: 510, interval: 0.45, types: { ddos: 3, worm: 2 } },
  { t: 600, interval: 0.42, types: { leak: 3, worm: 2, splitter: 1, sniper: 1, flanker: 1 } },
  { t: 680, interval: 0.4, types: { ddos: 4, worm: 2, charger: 1, bomber: 2, flanker: 2 } },
  { t: 760, interval: 0.38, types: { worm: 3, spam: 2, splitter: 1, sniper: 2, healer: 1, kiter: 1 } },
  { t: 840, interval: 0.35, types: { ddos: 3, spam: 3, charger: 2, bomber: 2, tank: 1, flanker: 2 } },
  { t: 900, interval: 0.4, types: { spam: 3 }, boss: 'kernel_panic' },
  { t: 960, interval: 0.32, types: { worm: 3, spam: 3, sniper: 2, healer: 1, tank: 1, kiter: 2 } },
  { t: 1040, interval: 0.28, types: { ddos: 4, spam: 3, splitter: 2, charger: 2, bomber: 3, flanker: 3 } },
  { t: 1120, interval: 0.25, types: { spam: 4, worm: 3, sniper: 2, charger: 2, tank: 2, healer: 1, kiter: 2 } },
  { t: 1200, interval: 0.35, types: { spam: 4 }, boss: 'data_destroyer' }
]

export const GAME_TIME = 1200
export const MAX_ENTITIES = 500
export const XP_CURVE = lv => 5 + (lv - 1) * 8 + (lv - 1) * (lv - 1) * 0.8

// ---------- 工具 ----------

const TAU = Math.PI * 2
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy }
const rand = (a, b) => a + Math.random() * (b - a)

// ---------- 对象池 ----------

class Pool {
  constructor(create) { this.create = create; this.free = [] }
  get() { return this.free.pop() || this.create() }
  put(o) { this.free.push(o) }
}

// ---------- 空间哈希网格 ----------

class SpatialHash {
  constructor(cell) { this.cell = cell; this.map = new Map() }
  clear() { this.map.clear() }
  insert(e) {
    const k = Math.floor(e.x / this.cell) + ',' + Math.floor(e.y / this.cell)
    let a = this.map.get(k)
    if (!a) { a = []; this.map.set(k, a) }
    a.push(e)
  }
  query(x, y, r) {
    const out = []
    const c = this.cell
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c)
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c)
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const a = this.map.get(i + ',' + j)
        if (a) for (let k = 0; k < a.length; k++) out.push(a[k])
      }
    }
    return out
  }
}

// ---------- 形状绘制 ----------

function drawShape(ctx, shape, r) {
  ctx.beginPath()
  if (shape === 'square') {
    ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6)
  } else if (shape === 'diamond') {
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0)
  } else {
    let n = 3
    if (shape === 'hex') n = 6
    else if (shape === 'pent') n = 5
    else if (shape === 'boss') n = 8
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU - Math.PI / 2
      const px = Math.cos(a) * r, py = Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
  }
  ctx.closePath()
}

// ---------- 主游戏类 ----------

export class SurvivorGame {
  constructor(canvas, cb) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.cb = cb || {}
    this.hash = new SpatialHash(72)
    this.pool = {
      enemy: new Pool(() => ({})),
      bullet: new Pool(() => ({}))
    }
    this.input = { x: 0, y: 0 }
    this.state = 'ready'
    this.time = 0
    this.kills = 0
    this.player = null
    this.enemies = []
    this.bullets = []
    this.ebullets = []
    this.gems = []
    this.particles = []
    this.floats = []
    this.novas = []
    this.lasers = []
    this.rains = []
    this.orbits = []
    this.waveIdx = 0
    this.spawnTimer = 0
    this.eliteTimer = 60
    this.combo = 0
    this.comboT = 0
    this.dashCd = 0
    this.dashT = 0
    this.dashTrail = []
    this.wallCds = {}
    this.mouse = { x: 0, y: 0 }
    this.event = null
    this.eventT = 0
    this.nextEvent = 75
    this.statT = 0
    this.raf = 0
    this.last = 0
    this.shakeT = 0
    this.flash = 0
    this.slowmo = 0
    this.bossWarn = 0
    this.hitStop = 0
    this.hbT = 0
    this.crt = true
    this.gold = 0
    this.coins = []
    this.shopTimer = 90
    this.shopItems = []
    this.shopRerolled = false
    this.curse = 0
    this.difficulty = 1
    this.overdrive = 0
    this.rootCharges = 0
    this.ultT = 0
    this.huntT = 180
    this.hunt = null
    this.glass = false
    this.greed = false
    this.daily = false
    // 视差星尘
    this.stars = []
    for (let i = 0; i < 70; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), s: rand(1, 2.4), d: rand(0.08, 0.35), a: rand(0.15, 0.5) })
    }
    this.vignette = null
    this.resize()
  }

  resize() {
    const dpr = window.devicePixelRatio || 1
    const w = this.canvas.clientWidth || 800
    const h = this.canvas.clientHeight || 600
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.W = w
    this.H = h
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // 渐晕暗角（缓存渐变，避免每帧重建）
    const vg = this.ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.62)
    vg.addColorStop(0, 'rgba(5,8,16,0)')
    vg.addColorStop(1, 'rgba(5,8,16,0.55)')
    this.vignette = vg
  }

  reset(charId) {
    this.state = 'playing'
    this.time = 0
    this.kills = 0
    this.charId = charId && CHARACTERS[charId] ? charId : 'ops'
    this.enemies = []
    this.bullets = []
    this.ebullets = []
    this.gems = []
    this.particles = []
    this.floats = []
    this.novas = []
    this.lasers = []
    this.rains = []
    this.orbits = []
    this.waveIdx = 0
    this.spawnTimer = 0
    this.eliteTimer = 60
    this.chests = []
    this.bossWarn = 0
    this.hitStop = 0
    this.hbT = 0
    this.gold = 0
    this.coins = []
    this.shopTimer = 90
    this.shopItems = []
    this.shopRerolled = false
    this.curse = 0
    this.overdrive = 0
    this.rootCharges = 0
    this.ultT = 0
    this.huntT = 180
    this.hunt = null
    this.glass = false
    this.greed = false
    this.pickups = []
    this.clones = []
    this.cloneReviveT = 0
    this.leakPools = []
    this.walls = []
    this.reorgT = 180
    this.props = []
    this.swamps = []
    this.propSeed()
    this.wallSeed()
    this.combo = 0
    this.comboT = 0
    this.dashCd = 0
    this.dashT = 0
    this.dashTrail = []
    this.wallCds = {}
    this.mouse = { x: 0, y: 0 }
    this.event = null
    this.eventT = 0
    this.nextEvent = 75
    this.achv = {}
    this.maxCombo = 0
    this.synergies = []
    this.zoomT = 0
    this.dailyMod = null
    if (this.daily) {
      const mods = [
        { name: '超频之日：敌人移速 +20%', speed: 1.2, elite: 1, gold: 1, xp: 1 },
        { name: '精英之日：精英出现频率 ×2', speed: 1, elite: 2, gold: 1, xp: 1 },
        { name: '匮乏之日：金币 -40%，经验 +30%', speed: 1, elite: 1, gold: 0.6, xp: 1.3 }
      ]
      this.dailyMod = mods[Math.floor(Date.now() / 86400000) % mods.length]
      this.floats.push({ x: 0, y: -40, txt: '📅 每日挑战：' + this.dailyMod.name, t: 3, color: '#f472b6', big: true })
    }
    this.player = {
      x: 0, y: 0, r: 12, hp: 100, maxHp: 100,
      speed: 170, pickup: 70, cdr: 0, armor: 0, crit: 0.05, regen: 0, dmgMul: 1,
      invuln: 0, face: 0, regenAcc: 0,
      level: 1, xp: 0, xpNeed: XP_CURVE(1),
      weapons: {}, passives: {}, evolutions: {},
      cds: {}, orbitA: 0
    }
    // 角色初始武器与特性
    const ch = CHARACTERS[this.charId]
    const p = this.player
    for (const wid of ch.weapons) p.weapons[wid] = 1
    if (ch.armor) p.armor += ch.armor
    if (ch.dmgMul) p.dmgMul *= ch.dmgMul
    if (ch.speed) p.speed *= ch.speed
  }

  recalc() {
    const p = this.player
    let speed = 170, maxHp = 100, cdr = 0, pickup = 70, armor = 0, crit = 0.05, regen = 0, dmg = 0
    for (const id in p.passives) {
      const s = PASSIVES[id]
      const v = s.per * p.passives[id]
      if (s.stat === 'speed') speed *= 1 + v
      else if (s.stat === 'maxHp') maxHp += v
      else if (s.stat === 'cdr') cdr += v
      else if (s.stat === 'pickup') pickup *= 1 + v
      else if (s.stat === 'armor') armor += v
      else if (s.stat === 'crit') crit += v
      else if (s.stat === 'regen') regen += v
      else if (s.stat === 'dmg') dmg += v
    }
    p.speed = speed
    p.pickup = pickup
    p.cdr = Math.min(0.6, cdr)
    p.armor = Math.min(0.6, armor)
    p.crit = Math.min(0.8, crit)
    p.regen = regen
    p.dmgMul = 1 + dmg
    // 武器协同：特定武器组合触发额外加成（Synergy）
    const has = id => !!p.weapons[id]
    const syn = []
    if (has('cannon') && has('firewall')) { p.armor = Math.min(0.7, p.armor + 0.10); syn.push('纵深防御：护甲+10%') }
    if (has('turret') && has('patch')) { p.cdr = Math.min(0.7, p.cdr + 0.10); syn.push('自动化运维：冷却-10%') }
    if (has('log') && has('grep')) { p.dmgMul += 0.10; syn.push('全链路追踪：伤害+10%') }
    if (has('ping') && has('backup')) { p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 20); syn.push('高可用架构：生命+20') }
    if (has('cron') && has('cache')) { p.crit = Math.min(0.85, p.crit + 0.05); syn.push('定时清理：暴击+5%') }
    this.synergies = this.synergies || []
    for (let i = 0; i < syn.length; i++) {
      if (this.synergies.indexOf(syn[i]) < 0) {
        this.synergies.push(syn[i])
        this.floats.push({ x: p.x, y: p.y - 60, txt: '⚡ 协同激活：' + syn[i], t: 2.5, color: '#5eead4', big: true })
        sound.play('levelup')
      }
    }
    if (p.hp > maxHp + 20) p.hp = maxHp + 20
    if (!this.synergies.length && p.hp > maxHp) p.hp = maxHp
    p.maxHp = Math.max(p.maxHp, maxHp)
  }

  start(charId) {
    this.reset(charId)
    this.last = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }
  // 暂停后恢复：仅重启渲染循环，不重置游戏状态
  resume() {
    this.last = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.loop)
  }
  // ---------- 存档系统 ----------
  saveGame() {
    if (this.state !== 'playing') return
    try {
      localStorage.setItem('survivor_save', JSON.stringify({
        v: 1, charId: this.charId, time: this.time, kills: this.kills, gold: this.gold, curse: this.curse,
        glass: this.glass, greed: this.greed, daily: this.daily, dailyMod: this.dailyMod,
        maxCombo: this.maxCombo, synergies: this.synergies, achv: this.achv,
        shopTimer: this.shopTimer, shopRerolled: this.shopRerolled, huntT: this.huntT, rootCharges: this.rootCharges,
        eliteTimer: this.eliteTimer, spawnTimer: this.spawnTimer, waveIdx: this.waveIdx,
        player: {
          hp: this.player.hp, level: this.player.level, xp: this.player.xp, xpNeed: this.player.xpNeed,
          weapons: this.player.weapons, passives: this.player.passives, evolutions: this.player.evolutions
        }
      }))
    } catch (e) { /* localStorage 不可用时忽略 */ }
  }
  static hasSave() {
    try { return !!localStorage.getItem('survivor_save') } catch (e) { return false }
  }
  static clearSave() {
    try { localStorage.removeItem('survivor_save') } catch (e) {}
  }
  // 从存档恢复：重置后回填存档数据并重启循环
  restoreSave() {
    let d
    try { d = JSON.parse(localStorage.getItem('survivor_save') || 'null') } catch (e) { return false }
    if (!d || !d.player) return false
    this.reset(d.charId)
    this.time = d.time; this.kills = d.kills; this.gold = d.gold; this.curse = d.curse
    this.glass = d.glass; this.greed = d.greed; this.daily = d.daily; this.dailyMod = d.dailyMod
    this.maxCombo = d.maxCombo || 0; this.synergies = d.synergies || []; this.achv = d.achv || {}
    this.shopTimer = d.shopTimer; this.shopRerolled = d.shopRerolled
    this.huntT = d.huntT; this.rootCharges = d.rootCharges
    this.eliteTimer = d.eliteTimer; this.spawnTimer = d.spawnTimer; this.waveIdx = d.waveIdx
    const p = this.player
    p.level = d.player.level; p.xp = d.player.xp; p.xpNeed = d.player.xpNeed
    p.weapons = d.player.weapons; p.passives = d.player.passives; p.evolutions = d.player.evolutions
    this.recalc()
    p.hp = Math.min(d.player.hp, p.maxHp)
    this.last = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.loop)
    return true
  }

  loop = (ts) => {
    if (this.state === 'over' || this.state === 'win') return
    this.raf = requestAnimationFrame(this.loop)
    let dt = (ts - this.last) / 1000
    this.last = ts
    if (dt > 0.05) dt = 0.05
    if (dt < 0) dt = 0
    if (this.slowmo > 0) { this.slowmo -= dt; dt *= 0.3 }
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.05 }
    if (this.state === 'playing') this.update(dt)
    else this.updateFx(dt)
    this.render()
    this.statsTick(dt)
  }

  update(dt) {
    this.time += dt
    const p = this.player
    // 连杀窗口
    if (this.comboT > 0) {
      this.comboT -= dt
      if (this.comboT <= 0) this.combo = 0
    }
    // 随机事件
    this.nextEvent -= dt
    if (this.nextEvent <= 0 && !this.event) this.triggerEvent()
    if (this.event) {
      this.eventT -= dt
      if (this.eventT <= 0) {
        this.event = null
        this.nextEvent = rand(70, 100)
      }
    }
    // 冲刺
    if (this.dashCd > 0) this.dashCd -= dt
    if (this.dashT > 0) {
      this.dashT -= dt
      const a = p.face
      p.x += Math.cos(a) * 620 * dt
      p.y += Math.sin(a) * 620 * dt
      p.invuln = Math.max(p.invuln, 0.1)
      // 残影拖尾
      this.dashTrail.push({ x: p.x, y: p.y, t: 0.35 })
      // 速度线粒子
      if (Math.random() < 0.9) {
        const back = a + Math.PI + rand(-0.5, 0.5)
        this.particles.push({ x: p.x + Math.cos(a) * 10, y: p.y + Math.sin(a) * 10, vx: Math.cos(back) * rand(120, 260), vy: Math.sin(back) * rand(120, 260), t: rand(0.15, 0.3), color: '#67e8f9', size: rand(2, 3) })
      }
    }
    // 移动
    let ix = this.input.x, iy = this.input.y
    const m = Math.hypot(ix, iy)
    if (m > 1) { ix /= m; iy /= m }
    p.x += ix * p.speed * dt
    p.y += iy * p.speed * dt
    // 墙体碰撞：玩家沿墙滑动
    const pc = this.collideWalls(p.x, p.y, p.r)
    p.x = pc.x; p.y = pc.y
    if (m > 0.1) p.face = Math.atan2(iy, ix)
    // 移动拖尾微粒
    if (m > 0.1 && Math.random() < 0.35) {
      this.particles.push({ x: p.x - ix * 10, y: p.y - iy * 10, vx: -ix * 40 + rand(-15, 15), vy: -iy * 40 + rand(-15, 15), t: rand(0.2, 0.4), color: '#22d3ee', size: rand(1.5, 2.5) })
    }
    if (p.invuln > 0) p.invuln -= dt
    // 回血
    if (p.regen > 0 && p.hp < p.maxHp) {
      p.regenAcc += p.regen * dt
      if (p.regenAcc >= 1) {
        const n = p.regenAcc | 0
        p.regenAcc -= n
        p.hp = Math.min(p.maxHp, p.hp + n)
      }
    }
    this.fireWeapons(dt)
    this.spawnLogic(dt)
    this.updateEnemies(dt)
    this.updateBullets(dt)
    this.updateProps(dt)
    this.updateGems(dt)
    this.updateFx(dt)
    // 波次商店：每 90 秒弹出
    if (this.state === 'playing') {
      this.shopTimer -= dt
      if (this.shopTimer <= 0) {
        this.shopTimer = 90
        this.openShop()
      }
      // 狂暴时刻计时
      if (this.overdrive > 0) this.overdrive -= dt
      // 大招演出计时
      if (this.ultT > 0) this.ultT -= dt
      // 备份恢复冷却计时
      if (this.cloneReviveT > 0) this.cloneReviveT -= dt
      // 动态音乐分层：敌人密度/Boss/狂暴决定伴奏强度
      let bossOn = false
      for (let bi = 0; bi < this.enemies.length; bi++) if (this.enemies[bi].boss && !this.enemies[bi].dead) { bossOn = true; break }
      sound.setIntensity(this.overdrive > 0 || bossOn ? 2 : (this.enemies.length > 25 ? 1 : 0))
      // zoom punch 计时
      if (this.zoomT > 0) this.zoomT -= dt
      // 猎杀目标：每 3 分钟强制刷限时精英
      if (this.hunt) {
        this.hunt.t -= dt
        if (this.hunt.e.dead) {
          // 猎杀成功：进化直通卡（直接进化一件满级武器）+ 金币奖励
          this.gold += 30
          const full = Object.keys(this.player.weapons).filter(id => this.player.weapons[id] >= 5 && !this.player.evolutions[id] && EVOLUTIONS[id])
          if (full.length) {
            const id = full[(Math.random() * full.length) | 0]
            this.player.evolutions[id] = true
            this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '★ 猎杀达成：' + EVOLUTIONS[id].name + ' 直接进化！', t: 2.5, color: EVOLUTIONS[id].color, big: true })
          } else {
            this.gold += 30
            this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '猎杀达成！+60 金币', t: 2, color: '#fde047', big: true })
          }
          sound.play('bosskill')
          this.hunt = null
        } else if (this.hunt.t <= 0) {
          // 猎杀失败：精英狂暴化
          this.hunt.e.speed *= 1.6
          this.hunt.e.dmg *= 1.4
          this.hunt.e.maxHp *= 1.5; this.hunt.e.hp = this.hunt.e.maxHp
          this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '猎杀失败！目标已狂暴化！', t: 2, color: '#f87171', big: true })
          this.hunt = null
        }
      } else {
        this.huntT -= dt
        if (this.huntT <= 0) {
          this.huntT = 180
          this.spawnHunt()
        }
      }
    }
  }
  // ---------- 猎杀目标 ----------
  spawnHunt() {
    // 生成限时猎杀精英（带倒计时标记）
    const w = WAVES[this.waveIdx]
    const types = Object.keys(w.types)
    const type = types[(Math.random() * types.length) | 0]
    const d = ENEMIES[type]
    const a = Math.random() * TAU
    const R = Math.hypot(this.W, this.H) / 2 + 60
    const e = this.pool.enemy.get()
    e.type = type; e.dead = false; e.orbitCd = 0; e.elite = true
    e.flashT = 0
    e.x = this.player.x + Math.cos(a) * R
    e.y = this.player.y + Math.sin(a) * R
    const mul = 1 + (this.time / 60) * (this.time < 300 ? 0.25 : 0.35)
    e.maxHp = d.hp * mul * 8
    e.hp = e.maxHp
    e.dmg = d.dmg * 1.3
    e.speed = d.speed * 0.9; e.r = d.r * 1.4; e.xp = d.xp * 6
    e.shape = d.shape; e.color = '#f0abfc'; e.boss = false
    e.affix = 'hunt'; e.affixName = '猎杀目标'; e.affixColor = '#f0abfc'
    this.enemies.push(e)
    this.hunt = { e, t: 45 }
    this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '🎯 猎杀目标出现！45 秒内击杀有重奖', t: 2.5, color: '#f0abfc', big: true })
    sound.play('boss')
  }
  // ---------- 波次商店 ----------
  openShop() {
    this.shopItems = this.rollShopItems()
    this.shopRerolled = false
    this.state = 'shop'
    sound.play('levelup')
    this.cb.onShop && this.cb.onShop({ items: this.shopItems, gold: this.gold, rerollCost: this.shopRerolled ? 0 : 5 })
  }
  rollShopItems() {
    const p = this.player
    const items = []
    // 商品池：新武器 / 武器强化 / 被动 / 治疗 / 诅咒
    const pool = []
    const wIds = Object.keys(p.weapons)
    for (const id in WEAPONS) {
      if (!p.weapons[id]) pool.push({ kind: 'new', id, name: WEAPONS[id].name, desc: WEAPONS[id].desc, color: WEAPONS[id].color, cost: 25 })
    }
    for (let i = 0; i < wIds.length; i++) {
      const id = wIds[i]
      const w = WEAPONS[id]
      if (p.weapons[id] < w.maxLv) pool.push({ kind: 'weapon', id, name: w.name + ' Lv' + (p.weapons[id] + 1), desc: w.up[p.weapons[id] - 1] || '强化', color: w.color, cost: 20 })
    }
    for (const id in PASSIVES) {
      const s = PASSIVES[id]
      if ((p.passives[id] || 0) < s.maxLv) pool.push({ kind: 'passive', id, name: s.name, desc: s.desc, color: s.color, cost: 18 })
    }
    pool.push({ kind: 'heal', id: 'heal', name: '紧急修复', desc: '回复 50% 生命', color: '#4ade80', cost: 12 })
    pool.push({ kind: 'curse', id: 'curse', name: '黑暗契约', desc: '敌人伤害+12%，金币掉率大增（可叠加）', color: '#c084fc', cost: 0 })
    if (!this.glass) pool.push({ kind: 'glass', id: 'glass', name: '玻璃大炮协议', desc: '造成伤害 +50%，受到伤害 ×2（一次性）', color: '#f87171', cost: 15 })
    if (!this.greed) pool.push({ kind: 'greed', id: 'greed', name: '贪婪协议', desc: '每枚金币价值 ×2（一次性）', color: '#fde047', cost: 15 })
    while (items.length < 4 && pool.length) {
      items.push(pool.splice((Math.random() * pool.length) | 0, 1)[0])
    }
    return items
  }
  shopBuy(idx) {
    const it = this.shopItems[idx]
    if (!it || this.state !== 'shop') return { ok: false }
    if (this.gold < it.cost) return { ok: false, msg: '金币不足' }
    this.gold -= it.cost
    this.applyShopItem(it)
    this.shopItems.splice(idx, 1)
    this.cb.onShop && this.cb.onShop({ items: this.shopItems, gold: this.gold, rerollCost: this.shopRerolled ? 0 : 5 })
    return { ok: true, gold: this.gold }
  }
  shopReroll() {
    if (this.state !== 'shop' || this.shopRerolled) return { ok: false }
    if (this.gold < 5) return { ok: false, msg: '金币不足' }
    this.gold -= 5
    this.shopRerolled = true
    this.shopItems = this.rollShopItems()
    this.cb.onShop && this.cb.onShop({ items: this.shopItems, gold: this.gold, rerollCost: 0 })
    return { ok: true }
  }
  applyShopItem(it) {
    const p = this.player
    if (it.kind === 'new') p.weapons[it.id] = 1
    else if (it.kind === 'weapon') p.weapons[it.id] = (p.weapons[it.id] || 0) + 1
    else if (it.kind === 'passive') {
      p.passives[it.id] = (p.passives[it.id] || 0) + 1
      this.recalc()
    } else if (it.kind === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5)
    } else if (it.kind === 'curse') {
      this.curse++
      this.floats.push({ x: p.x, y: p.y - 40, txt: '☠ 黑暗契约 ×' + this.curse, t: 2, color: '#c084fc', big: true })
    } else if (it.kind === 'glass') {
      this.glass = true
      this.floats.push({ x: p.x, y: p.y - 40, txt: '☠ 玻璃大炮协议：伤害+50%，承伤×2', t: 2.5, color: '#f87171', big: true })
    } else if (it.kind === 'greed') {
      this.greed = true
      this.floats.push({ x: p.x, y: p.y - 40, txt: '☠ 贪婪协议：金币价值×2', t: 2.5, color: '#fde047', big: true })
    }
    sound.play('pickup')
  }
  shopClose() {
    if (this.state !== 'shop') return
    this.state = 'playing'
  }

  // ---------- 武器 ----------

  fireWeapons(dt) {
    const p = this.player
    this.orbits = []
    for (const k in this.wallCds) {
      this.wallCds[k] -= dt
      if (this.wallCds[k] <= 0) delete this.wallCds[k]
    }
    for (const id in p.weapons) {
      const lv = p.weapons[id]
      const w = WEAPONS[id]
      if (w.type === 'orbit' && w.arc) {
        p.orbitA += w.spin * dt
        const rings = lv >= 5 ? 3 : (lv >= 3 ? 2 : 1)
        const dmg = w.dmg * (1 + (lv - 1) * 0.35)
        for (let ring = 0; ring < rings; ring++) {
          const rad = w.radius + ring * 48
          const n = w.count + (lv >= 2 ? 1 : 0) + (lv >= 4 ? 1 : 0) + ring
          for (let i = 0; i < n; i++) {
            const a = p.orbitA * (ring % 2 ? -1 : 1) + i * TAU / n
            const key = ring + '_' + i
            this.orbits.push({ arc: true, radius: rad, a, arc: w.arc, size: w.size, dmg, color: w.color, key, cd: this.wallCds[key] || 0 })
          }
        }
      } else if (w.type === 'clone') {
        // 备份分身：维持克隆体数量，跟随玩家并自动开火
        const want = 1 + (lv >= 2 ? 1 : 0) + (lv >= 4 ? 1 : 0)
        while (this.clones.length < want) {
          this.clones.push({ x: p.x, y: p.y, a: 0, cd: 0, dead: false, respawnT: 0 })
        }
        const evo = p.evolutions[id] && EVOLUTIONS[id]
        const dmgMul = (1 + (lv - 1) * 0.35) * (evo ? evo.dmgMul : 1)
        const cdMul = (lv >= 5 ? 0.6 : 1) * (evo ? evo.cdMul : 1)
        for (let i = 0; i < this.clones.length; i++) {
          const c = this.clones[i]
          // 阵位：围绕玩家分布
          const slot = i * TAU / this.clones.length + this.time * 0.5
          const tx = p.x + Math.cos(slot) * 46, ty = p.y + Math.sin(slot) * 46
          const dx = tx - c.x, dy = ty - c.y
          const dd = Math.hypot(dx, dy) || 1
          const spd = Math.min(dd / dt, 260)
          c.x += dx / dd * spd * dt
          c.y += dy / dd * spd * dt
          // 自动朝最近敌人开火
          c.cd -= dt
          if (c.cd <= 0) {
            const t = this.nearestEnemy(c.x, c.y)
            if (t && dist2(c.x, c.y, t.x, t.y) < 420 * 420) {
              c.cd = w.cd * cdMul * (1 - p.cdr) * (this.overdrive > 0 ? 0.5 : 1)
              const a = Math.atan2(t.y - c.y, t.x - c.x)
              this.addBullet(c.x, c.y, a, 420, w.dmg * dmgMul, 0, 4, w.color, false)
              this.particles.push({ x: c.x + Math.cos(a) * 10, y: c.y + Math.sin(a) * 10, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50, t: 0.1, color: '#fde047', size: 3 })
            }
          }
        }
      } else if (w.type === 'wave') {
        continue
      } else {
        p.cds[id] = (p.cds[id] || 0) - dt
        if (p.cds[id] <= 0) {
          const fired = this.fireWeapon(id, w, lv)
          const evo = p.evolutions[id] && EVOLUTIONS[id]
          if (fired) p.cds[id] = w.cd * (id === 'cannon' && lv >= 2 ? 0.7 : 1) * (id === 'turret' && lv >= 2 ? 0.6 : 1) * (evo ? evo.cdMul : 1) * (this.overdrive > 0 ? 0.5 : 1) * (1 - p.cdr)
        }
      }
    }
  }

  fireWeapon(id, w, lv) {
    const p = this.player
    const evo = p.evolutions[id] && EVOLUTIONS[id]
    const mul = (1 + (lv - 1) * 0.3) * (evo ? evo.dmgMul : 1)
    if (w.type === 'auto') {
      // 主炮：朝鼠标方向单发自动射击
      let tx, ty
      if (this.mouse.x || this.mouse.y) {
        tx = p.x + (this.mouse.x - this.W / 2)
        ty = p.y + (this.mouse.y - this.H / 2)
      } else {
        tx = p.x + Math.cos(p.face) * 100
        ty = p.y + Math.sin(p.face) * 100
      }
      const a = Math.atan2(ty - p.y, tx - p.x)
      const dmg = w.dmg * mul + p.level
      const pierce = w.pierce + (lv >= 4 ? 1 : 0)
      const br = evo && evo.big ? 10 : 6
      if (lv >= 5) {
        const ox = Math.cos(a + Math.PI / 2) * 8, oy = Math.sin(a + Math.PI / 2) * 8
        this.addBullet(p.x + ox, p.y + oy, a, w.speed, dmg, pierce, br, w.color, false)
        this.addBullet(p.x - ox, p.y - oy, a, w.speed, dmg, pierce, br, w.color, false)
      } else {
        this.addBullet(p.x, p.y, a, w.speed, dmg, pierce, br, w.color, false)
      }
      // 枪口焰：炮口炸出短促亮黄闪光
      const tipX = p.x + Math.cos(a) * (p.r + 10)
      const tipY = p.y + Math.sin(a) * (p.r + 10)
      this.particles.push({ x: tipX, y: tipY, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, t: 0.12, color: '#fde047', size: 5 })
      this.particles.push({ x: tipX, y: tipY, vx: rand(-30, 30), vy: rand(-30, 30), t: 0.1, color: '#fef9c3', size: 3 })
      sound.play('shoot')
      return true
    }
    if (w.type === 'turret') {
      // 副机枪：环绕玩家的炮塔自动锁定最近故障扫射
      const t = this.nearestEnemy(p.x, p.y)
      if (!t) return false
      const n = lv >= 4 ? 2 : 1
      const dm = w.dmg * mul * (lv >= 3 ? 1.5 : 1)
      const pierce = w.pierce + (lv >= 5 ? 1 : 0)
      for (let i = 0; i < n; i++) {
        const off = this.time * 1.2 + (i * Math.PI) / n
        const gx = p.x + Math.cos(off) * 26, gy = p.y + Math.sin(off) * 26
        const a = Math.atan2(t.y - gy, t.x - gx)
        this.addBullet(gx, gy, a, w.speed, dm, pierce, 4, w.color, false)
        this.particles.push({ x: gx + Math.cos(a) * 7, y: gy + Math.sin(a) * 7, vx: 0, vy: 0, t: 0.08, color: '#fde047', size: 3 })
      }
      sound.play('shoot')
      return true
    }
    if (w.type === 'shot') {
      const t = this.nearestEnemy(p.x, p.y)
      if (!t) return false
      const n = w.count + (lv >= 2 ? 1 : 0) + (lv >= 5 ? 1 : 0)
      const base = Math.atan2(t.y - p.y, t.x - p.x)
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.18
        this.addBullet(p.x, p.y, a, w.speed, w.dmg * mul, w.pierce + (lv >= 4 ? 1 : 0), 5, w.color, false)
      }
      sound.play('shoot')
      return true
    }
    if (w.type === 'homing') {
      const n = w.count + (lv >= 2 ? 1 : 0) + (lv >= 5 ? 1 : 0)
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU
        this.addBullet(p.x, p.y, a, w.speed, w.dmg * mul, 1, 6, w.color, true)
        // 感电：搜索弹命中后连锁跳跃
        this.bullets[this.bullets.length - 1].shock = true
      }
      sound.play('shoot')
      return true
    }
    if (w.type === 'laser') {
      const t = this.nearestEnemy(p.x, p.y)
      if (!t) return false
      const a = Math.atan2(t.y - p.y, t.x - p.x)
      const len = w.len + (lv >= 5 ? 120 : 0)
      const half = (w.width + (lv >= 3 ? 8 : 0)) / 2
      const dmg = w.dmg * mul
      const ex = p.x + Math.cos(a) * len, ey = p.y + Math.sin(a) * len
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (e.dead) continue
        const tt = Math.max(0, Math.min(1, ((e.x - p.x) * (ex - p.x) + (e.y - p.y) * (ey - p.y)) / (len * len)))
        const px = p.x + (ex - p.x) * tt, py = p.y + (ey - p.y) * tt
        if (dist2(e.x, e.y, px, py) < (e.r + half) * (e.r + half)) {
          this.dealDamage(e, dmg)
          // 灼烧：持续伤害
          e.burnT = 2; e.burnDps = dmg * 0.25
        }
      }
      this.lasers.push({ x: p.x, y: p.y, ex, ey, t: 0.25, w: half * 2, color: w.color })
      return true
    }
    if (w.type === 'nova') {
      const radius = w.radius + (lv >= 2 ? 30 : 0) + (lv >= 5 ? 30 : 0)
      const dmg = w.dmg * mul
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.dead && dist2(e.x, e.y, p.x, p.y) < (radius + e.r) * (radius + e.r)) {
          this.dealDamage(e, dmg)
          // 减速：脉冲震荡
          e.slowT = 1.2
        }
      }
      this.novas.push({ x: p.x, y: p.y, t: 0, dur: 0.4, radius, color: w.color })
      return true
    }
    if (w.type === 'rain') {
      const n = w.count + (lv >= 2 ? 1 : 0) + (lv >= 5 ? 1 : 0)
      const radius = w.radius + (lv >= 5 ? 14 : 0)
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, d = rand(60, 260)
        this.rains.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, t: 0.55, radius, dmg: w.dmg * mul, color: w.color })
      }
      return true
    }
    return false
  }

  addBullet(x, y, a, speed, dmg, pierce, r, color, homing) {
    const b = this.pool.bullet.get()
    b.x = x; b.y = y; b.a = a
    b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed
    b.speed = speed; b.dmg = dmg; b.pierce = pierce; b.r = r
    b.color = color; b.homing = homing; b.target = null
    b.shock = false; b.shocked = false
    b.life = 3; b.dead = false
    this.bullets.push(b)
  }

  // ---------- 可交互地图物件 ----------
  // 墙体：程序化机柜墙块（阻挡移动与子弹，形成走廊/掩体）
  wallSeed() {
    this.walls = []
    const p = this.player
    if (!p) return
    // 以玩家出生点为中心的 3200x2400 数据中心内散布机柜集群
    const CX = 0, CY = 0
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU
      const r = rand(320, 1500)
      const wx = CX + Math.cos(a) * r
      const wy = CY + Math.sin(a) * r
      // 出生安全区不生成
      if (Math.hypot(wx - CX, wy - CY) < 260) continue
      // 机柜：竖长矩形，部分横放，成组生成
      const horiz = Math.random() < 0.4
      const w = horiz ? rand(60, 110) : rand(26, 40)
      const h = horiz ? rand(26, 40) : rand(60, 110)
      this.walls.push({ x: wx, y: wy, w, h })
      // 30% 概率生成相邻第二柜，形成 L 形掩体
      if (Math.random() < 0.3) {
        this.walls.push({ x: wx + (horiz ? rand(50, 70) : rand(-16, 16)), y: wy + (horiz ? rand(-16, 16) : rand(50, 70)), w: horiz ? rand(26, 40) : rand(60, 110), h: horiz ? rand(60, 110) : rand(26, 40) })
      }
    }
  }
  // AABB 碰撞：圆形实体 vs 墙，返回推出后的坐标（滑墙效果）
  collideWalls(x, y, r) {
    for (let i = 0; i < this.walls.length; i++) {
      const wd = this.walls[i]
      // 快速剔除
      if (x + r < wd.x || x - r > wd.x + wd.w || y + r < wd.y || y - r > wd.y + wd.h) continue
      // 最近点推出
      const nx = Math.max(wd.x, Math.min(x, wd.x + wd.w))
      const ny = Math.max(wd.y, Math.min(y, wd.y + wd.h))
      const dx = x - nx, dy = y - ny
      const dd = Math.hypot(dx, dy)
      if (dd < r) {
        if (dd > 0.001) {
          x = nx + dx / dd * r
          y = ny + dy / dd * r
        } else {
          // 圆心在墙内：朝最近边推出
          const l = x - wd.x, rt = wd.x + wd.w - x, tp = y - wd.y, bt = wd.y + wd.h - y
          const mn = Math.min(l, rt, tp, bt)
          if (mn === l) x = wd.x - r
          else if (mn === rt) x = wd.x + wd.w + r
          else if (mn === tp) y = wd.y - r
          else y = wd.y + wd.h + r
        }
      }
    }
    return { x, y }
  }
  // 点是否在墙内（子弹判定）
  pointInWall(x, y) {
    for (let i = 0; i < this.walls.length; i++) {
      const wd = this.walls[i]
      if (x >= wd.x && x <= wd.x + wd.w && y >= wd.y && y <= wd.y + wd.h) return true
    }
    return false
  }
  propSeed() {
    const p = this.player
    if (!p) return
    const want = { capacitor: 5, crystal: 4, emp: 2 }
    const counts = { capacitor: 0, crystal: 0, emp: 0 }
    for (let i = 0; i < this.props.length; i++) counts[this.props[i].kind] = (counts[this.props[i].kind] || 0) + 1
    for (const kind in want) {
      while (counts[kind] < want[kind]) {
        const a = Math.random() * TAU
        const r = rand(380, 900)
        this.props.push({ kind, x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, r: kind === 'emp' ? 14 : 12, pulseT: rand(2, 5), fuse: 0 })
        counts[kind]++
      }
    }
    while (this.swamps.length < 3) {
      const a = Math.random() * TAU
      const r = rand(500, 1100)
      this.swamps.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, r: rand(90, 150) })
    }
  }
  explodeCapacitor(c) {
    const dmg = 90 * (1 + this.time / 60)
    const near = this.hash.query(c.x, c.y, 150)
    for (let i = 0; i < near.length; i++) {
      const e = near[i]
      if (e.dead) continue
      if (dist2(c.x, c.y, e.x, e.y) < 150 * 150) {
        this.dealDamage(e, dmg)
        if (!e.boss) { e.x += (e.x - c.x) / 150 * 30; e.y += (e.y - c.y) / 150 * 30 }
      }
    }
    this.novas.push({ x: c.x, y: c.y, t: 0, dur: 0.4, radius: 150, color: '#fb923c' })
    this.burst(c.x, c.y, '#fb923c', 14)
    this.shakeT = this.time + 0.25
    sound.play('bosskill')
    for (let i = 0; i < this.props.length; i++) {
      const o = this.props[i]
      if (o.kind === 'capacitor' && o.fuse <= 0 && dist2(c.x, c.y, o.x, o.y) < 170 * 170) o.fuse = 0.15
    }
  }
  breakCrystal(c) {
    const n = 4 + ((this.time / 240) | 0)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = rand(6, 30)
      this.gems.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, v: 3 })
    }
    for (let i = 0; i < 3; i++) this.coins.push({ x: c.x + rand(-14, 14), y: c.y + rand(-14, 14) })
    this.burst(c.x, c.y, '#22d3ee', 12)
    this.floats.push({ x: c.x, y: c.y - 20, txt: '数据水晶击碎！', t: 1.2, color: '#22d3ee', big: true })
    sound.play('pickup')
  }
  updateProps(dt) {
    const p = this.player
    if (!p) return
    // 内存泄漏巨兽毒迹：倒计时衰减 + 玩家站入掉血
    for (let i = this.leakPools.length - 1; i >= 0; i--) {
      const lp = this.leakPools[i]
      lp.t -= dt
      if (lp.t <= 0) { this.leakPools.splice(i, 1); continue }
      if (dist2(p.x, p.y, lp.x, lp.y) < lp.r * lp.r) {
 this.leakHurtT = (this.leakHurtT || 0) - dt
        if (this.leakHurtT <= 0) {
          this.leakHurtT = 0.6
          this.hurtPlayer(4 + this.time / 90)
          this.floats.push({ x: p.x, y: p.y - 14, txt: '泄漏侵蚀', t: 0.5, color: '#06b6d4' })
        }
      }
    }
    this.propSeedT = (this.propSeedT || 0) - dt
    if (this.propSeedT <= 0) { this.propSeedT = 4; this.propSeed() }
    this.swampTick = (this.swampTick || 0) - dt
    if (this.swampTick <= 0) {
      this.swampTick = 0.5
      for (let i = 0; i < this.swamps.length; i++) {
        const s = this.swamps[i]
        if (dist2(p.x, p.y, s.x, s.y) < s.r * s.r) {
          this.hurtPlayer(3 + this.time / 120)
          this.floats.push({ x: p.x, y: p.y - 14, txt: '毒沼侵蚀', t: 0.5, color: '#a3e635' })
          break
        }
      }
    }
    for (let i = this.props.length - 1; i >= 0; i--) {
      const c = this.props[i]
      if (c.fuse > 0) {
        c.fuse -= dt
        if (c.fuse <= 0) { this.explodeCapacitor(c); this.props.splice(i, 1); continue }
      }
      if (c.kind === 'emp') {
        c.pulseT -= dt
        if (c.pulseT <= 0) {
          c.pulseT = 5
          const near = this.hash.query(c.x, c.y, 170)
          let hit = 0
          for (let k = 0; k < near.length; k++) {
            const e = near[k]
            if (e.dead) continue
            if (dist2(c.x, c.y, e.x, e.y) < 170 * 170) { e.frozenT = 1.5; hit++ }
          }
          this.novas.push({ x: c.x, y: c.y, t: 0, dur: 0.5, radius: 170, color: '#60a5fa' })
          if (hit > 0) this.floats.push({ x: c.x, y: c.y - 24, txt: 'EMP 麻痹 x' + hit, t: 1, color: '#60a5fa' })
        }
      }
      if (c.kind === 'capacitor' || c.kind === 'crystal') {
        for (let j = 0; j < this.bullets.length; j++) {
          const b = this.bullets[j]
          if (b.dead) continue
          if (dist2(b.x, b.y, c.x, c.y) < (c.r + b.r + 2) * (c.r + b.r + 2)) {
            if (c.kind === 'capacitor') { c.fuse = 0.01 } else { this.breakCrystal(c); this.props.splice(i, 1) }
            break
          }
        }
      }
    }
  }
  // ---------- 生成 ----------

  spawnLogic(dt) {
    while (this.waveIdx < WAVES.length - 1 && this.time >= WAVES[this.waveIdx + 1].t) {
      this.waveIdx++
      const w = WAVES[this.waveIdx]
      if (w.boss) this.spawnBoss(w.boss)
    }
    this.eliteTimer -= dt
    if (this.eliteTimer <= 0) {
      this.eliteTimer = 75 / (this.dailyMod ? this.dailyMod.elite : 1)
      this.spawnElite()
    }
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      const w = WAVES[this.waveIdx]
      this.spawnTimer = w.interval
      for (const type in w.types) {
        for (let i = 0; i < w.types[type]; i++) this.spawnEnemy(type)
      }
    }
  }

  spawnEnemy(type) {
    if (this.enemies.length >= MAX_ENTITIES) return
    const d = ENEMIES[type]
    const a = Math.random() * TAU
    const R = Math.hypot(this.W, this.H) / 2 + 60
    const e = this.pool.enemy.get()
    e.type = type; e.dead = false; e.orbitCd = 0
    e.elite = false; e.child = false; e.gold = Math.random() < 0.03; e.frozenT = 0
    e.flashT = 0
    e.x = this.player.x + Math.cos(a) * R
    e.y = this.player.y + Math.sin(a) * R
    const mul = 1 + (this.time / 60) * (this.time < 300 ? 0.25 : 0.35)
    e.maxHp = d.hp * mul
    e.hp = e.maxHp
    e.dmg = d.dmg * (1 + (this.time / 60) * 0.12)
    e.speed = d.speed * (1 + (this.time / 60) * 0.06) * (this.dailyMod ? this.dailyMod.speed : 1); e.r = d.r; e.xp = d.xp * (this.dailyMod ? this.dailyMod.xp : 1)
    e.shape = d.shape; e.color = d.color; e.boss = !!d.boss
    if (e.gold) {
      e.maxHp *= 3; e.hp = e.maxHp
      e.xp = d.xp * 5
      e.color = '#fde047'
    }
    this.enemies.push(e)
  }

  triggerEvent() {
    const r = Math.random()
    if (r < 0.4) {
      this.event = 'horde'
      this.eventT = 10
      const w = WAVES[this.waveIdx]
      const types = Object.keys(w.types)
      for (let i = 0; i < 24; i++) {
        this.spawnEnemy(types[(Math.random() * types.length) | 0])
      }
      this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '⚠ 流量洪峰来袭！', t: 2.5, color: '#f87171', big: true })
      sound.play('boss')
    } else if (r < 0.7) {
      this.event = 'slow'
      this.eventT = 10
      this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '系统维护中：全场减速', t: 2.5, color: '#60a5fa', big: true })
      sound.play('levelup')
    } else {
      this.event = 'doublexp'
      this.eventT = 12
      this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '双倍经验时段！', t: 2.5, color: '#2dd4bf', big: true })
      sound.play('levelup')
    }
  }

  spawnChild(type, x, y) {
    if (this.enemies.length >= MAX_ENTITIES) return
    const d = ENEMIES[type]
    const e = this.pool.enemy.get()
    e.type = type; e.dead = false; e.orbitCd = 0; e.elite = false; e.child = true
    e.flashT = 0
    e.x = x; e.y = y
    const mul = 1 + (this.time / 60) * (this.time < 300 ? 0.25 : 0.35)
    e.maxHp = d.hp * mul; e.hp = e.maxHp
    e.dmg = d.dmg
    e.speed = d.speed * 1.2; e.r = d.r * 0.8; e.xp = d.xp
    e.shape = d.shape; e.color = d.color; e.boss = false
    this.enemies.push(e)
  }

  dropPickup(x, y) {
    const r = Math.random()
    const type = r < 0.4 ? 'heal' : r < 0.7 ? 'magnet' : 'bomb'
    this.pickups.push({ x, y, type })
  }

  applyPickup(type) {
    const p = this.player
    if (type === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3)
      this.floats.push({ x: p.x, y: p.y - 20, txt: '+HP', t: 1, color: '#4ade80', big: true })
      sound.play('pickup')
    } else if (type === 'magnet') {
      for (let i = 0; i < this.gems.length; i++) this.gems[i].mag = true
      this.floats.push({ x: p.x, y: p.y - 20, txt: '磁力全收！', t: 1, color: '#60a5fa', big: true })
      sound.play('pickup')
    } else if (type === 'bomb') {
      const dmg = 150 * (1 + this.time / 60)
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.dead) this.dealDamage(e, dmg)
      }
      this.novas.push({ x: p.x, y: p.y, t: 0, dur: 0.6, radius: 420, color: '#fb7185' })
      this.shakeT = this.time + 0.4
      sound.play('bosskill')
    } else if (type === 'root') {
      this.rootCharges++
      this.floats.push({ x: p.x, y: p.y - 20, txt: 'root 权限获取！按 Q 释放 rm -rf', t: 1.6, color: '#f0abfc', big: true })
      sound.play('levelup')
    }
  }

  spawnElite() {
    const w = WAVES[this.waveIdx]
    const types = Object.keys(w.types)
    const type = types[(Math.random() * types.length) | 0]
    const d = ENEMIES[type]
    const a = Math.random() * TAU
    const R = Math.hypot(this.W, this.H) / 2 + 60
    const e = this.pool.enemy.get()
    e.type = type; e.dead = false; e.orbitCd = 0; e.elite = true
    e.flashT = 0
    e.x = this.player.x + Math.cos(a) * R
    e.y = this.player.y + Math.sin(a) * R
    const mul = 1 + (this.time / 60) * (this.time < 300 ? 0.25 : 0.35)
    e.maxHp = d.hp * mul * 10
    e.hp = e.maxHp
    e.dmg = d.dmg * 1.5
    e.speed = d.speed * 0.85; e.r = d.r * 1.5; e.xp = d.xp * 8
    e.shape = d.shape; e.color = '#fde047'; e.boss = false
    // 精英词缀：随机附加强化词条
    const AFFIXES = [
      { id: 'swift', name: '迅捷', color: '#4ade80', apply: e => { e.speed *= 1.5 } },
      { id: 'shield', name: '护盾', color: '#60a5fa', apply: e => { e.maxHp *= 1.6; e.hp = e.maxHp } },
      { id: 'berserk', name: '狂暴', color: '#f87171', apply: e => { e.dmg *= 1.6 } },
      { id: 'vampiric', name: '吸血', color: '#e879f9', apply: e => { e.vampiric = true } }
    ]
    const affix = AFFIXES[(Math.random() * AFFIXES.length) | 0]
    e.affix = affix.id; e.affixName = affix.name; e.affixColor = affix.color
    affix.apply(e)
    this.enemies.push(e)
    this.floats.push({ x: this.player.x, y: this.player.y - 40, txt: '精英故障【' + affix.name + '】出现，击杀掉落宝箱', t: 1.6, color: '#fde047', big: true })
  }

  spawnBoss(type) {
    this.spawnEnemy(type)
    const d = ENEMIES[type]
    sound.play('boss')
    this.bossWarn = 2
    this.slowmo = 0.6
    this.floats.push({ x: this.player.x, y: this.player.y - 60, txt: '⚠ ' + d.name + ' 出现', t: 2, color: d.color, big: true })
  }

  // ---------- 更新 ----------

  updateEnemies(dt) {
    const p = this.player
    this.hash.clear()
    for (let i = 0; i < this.enemies.length; i++) this.hash.insert(this.enemies[i])
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead) continue
      if (e.flashT > 0) e.flashT -= dt
      // 状态效果：灼烧持续伤害 + 减速计时
      if (e.burnT > 0) {
        e.burnT -= dt
        e.burnAcc = (e.burnAcc || 0) + e.burnDps * dt
        if (e.burnAcc >= 1) {
          const n = e.burnAcc | 0
          e.burnAcc -= n
          e.hp -= n
          if (Math.random() < 0.3) this.particles.push({ x: e.x + rand(-4, 4), y: e.y + rand(-4, 4), vx: rand(-10, 10), vy: -rand(20, 50), t: 0.3, color: '#fb923c', size: 2.5 })
          if (e.hp <= 0) { this.killEnemy(e); continue }
        }
      }
      if (e.slowT > 0) e.slowT -= dt
      // EMP 麻痹：冻结期间完全停止行动
      if (e.frozenT > 0) {
        e.frozenT -= dt
        if (Math.random() < 0.2) this.particles.push({ x: e.x + rand(-6, 6), y: e.y + rand(-6, 6), vx: 0, vy: 0, t: 0.2, color: '#60a5fa', size: 2 })
        continue
      }
      const dx = p.x - e.x, dy = p.y - e.y
      const d = Math.hypot(dx, dy) || 1
      let spd = e.speed * (this.event === 'slow' ? 0.45 : 1) * (e.slowT > 0 ? 0.5 : 1)
      // 群体分离力：敌人互相推开，形成潮水包抄而非叠罗汉
      if (!e.boss) {
        const near = this.hash.query(e.x, e.y, e.r * 2)
        for (let k = 0; k < near.length; k++) {
          const o = near[k]
          if (o === e || o.dead) continue
          const odx = e.x - o.x, ody = e.y - o.y
          const odd = Math.hypot(odx, ody) || 1
          const minD = e.r + o.r
          if (odd < minD) {
            const push = (minD - odd) / minD * 60 * dt
            e.x += odx / odd * push
            e.y += ody / odd * push
          }
        }
      }
      // 自爆程序：贴近后引信闪烁 0.8s 自爆 AoE
      if (e.type === 'bomber') {
        if (e.fuseT > 0) {
          e.fuseT -= dt
          if (e.fuseT <= 0) {
            // 自爆：范围伤害 + 冲击波
            if (Math.hypot(p.x - e.x, p.y - e.y) < 70 + p.r) this.hurtPlayer(e.dmg)
            this.novas.push({ x: e.x, y: e.y, t: 0, dur: 0.35, radius: 70, color: '#f87171' })
            this.burst(e.x, e.y, '#f87171', 10)
            this.shakeT = this.time + 0.2
            e.hp = 0
            this.killEnemy(e)
            continue
          }
        } else {
          e.x += dx / d * spd * dt
          e.y += dy / d * spd * dt
          if (d < e.r + p.r + 26) e.fuseT = 0.8
        }
      } else if (e.type === 'healer') {
        // 修复进程：保持距离，周期治疗附近敌人（绿色光束）
        e.healT = (e.healT === undefined ? 2 : e.healT) - dt
        if (d > 260) {
          e.x += dx / d * spd * dt
          e.y += dy / d * spd * dt
        } else if (d < 180) {
          e.x -= dx / d * spd * 0.6 * dt
          e.y -= dy / d * spd * 0.6 * dt
        }
        if (e.healT <= 0) {
          e.healT = 2.4
          const near = this.hash.query(e.x, e.y, 160)
          let healed = 0
          for (let k = 0; k < near.length && healed < 2; k++) {
            const t = near[k]
            if (t === e || t.dead || t.hp >= t.maxHp) continue
            t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.15)
            this.lasers.push({ x: e.x, y: e.y, ex: t.x, ey: t.y, t: 0.2, w: 2, color: '#4ade80' })
            healed++
          }
        }
      } else if (e.type === 'tank') {
        // 堡垒进程：超慢超厚肉盾，免疫击退
        e.x += dx / d * spd * dt
        e.y += dy / d * spd * dt
      } else if (e.boss) {
        // ---------- Boss 技能循环（按类型分化） ----------
        if (e.type === 'memory_leak') {
          // 内存泄漏巨兽：追击 + 泄漏毒迹 + 吞噬成长
          e.x += dx / d * spd * dt
          e.y += dy / d * spd * dt
          // 泄漏毒迹：移动中周期性在脚下留下毒圈
          e.leakT = (e.leakT === undefined ? 1.2 : e.leakT) - dt
          if (e.leakT <= 0) {
            e.leakT = 1.2
            this.leakPools.push({ x: e.x, y: e.y, r: 46, t: 4 })
          }
          // 吞噬成长：周期吞噬附近小怪回血 + 体型增大
          e.devourT = (e.devourT === undefined ? 8 : e.devourT) - dt
          if (e.devourT <= 0) {
            e.devourT = 8
            const near = this.hash.query(e.x, e.y, 160)
            for (let k = 0; k < near.length; k++) {
              const t = near[k]
              if (t === e || t.dead || t.boss) continue
              if (dist2(e.x, e.y, t.x, t.y) < 160 * 160) {
                t.hp = 0; this.killEnemy(t)
                e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.06)
                e.r = Math.min(40, e.r + 1.5)
                this.lasers.push({ x: e.x, y: e.y, ex: t.x, ey: t.y, t: 0.25, w: 4, color: '#06b6d4' })
                this.floats.push({ x: e.x, y: e.y - e.r - 10, txt: '吞噬成长！', t: 1, color: '#06b6d4' })
                break
              }
            }
          }
        } else if (e.type === 'kernel_panic') {
          // 内核恐慌：蓄力冲锋（预警线）+ 环形弹幕 + 召唤
          if (e.telegraph > 0) {
            // 蓄力阶段：站定画预警线
            e.telegraph -= dt
            if (e.telegraph <= 0) {
              e.charging = 0.55
              e.chargeA = Math.atan2(p.y - e.y, p.x - e.x)
              sound.play('boss')
            }
          } else if (e.charging > 0) {
            // 冲锋阶段：直线猛冲
            e.charging -= dt
            e.x += Math.cos(e.chargeA) * spd * 7 * dt
            e.y += Math.sin(e.chargeA) * spd * 7 * dt
            if (Math.random() < 0.7) this.particles.push({ x: e.x + rand(-10, 10), y: e.y + rand(-10, 10), vx: 0, vy: 0, t: 0.25, color: '#dc2626', size: 3 })
          } else {
            e.x += dx / d * spd * 0.7 * dt
            e.y += dy / d * spd * 0.7 * dt
            e.bossSkillT = (e.bossSkillT === undefined ? 3 : e.bossSkillT) - dt
            if (e.bossSkillT <= 0) {
              e.bossSkillT = 4.5
              e.bossPhase = ((e.bossPhase || 0) + 1) % 3
              if (e.bossPhase === 0) {
                // 环形弹幕：12 发放射状弹
                for (let k = 0; k < 12; k++) {
                  const a = (k / 12) * TAU + this.time
                  this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 180, vy: Math.sin(a) * 180, r: 5, dmg: e.dmg * 0.5, t: 3.5 })
                }
                this.novas.push({ x: e.x, y: e.y, t: 0, dur: 0.4, radius: 60, color: e.color })
              } else if (e.bossPhase === 1) {
                // 蓄力冲锋：0.8s 预警线后猛冲
                e.telegraph = 0.8
              } else {
                // 召唤 4 只小怪
                for (let k = 0; k < 4; k++) {
                  const a = Math.random() * TAU
                  this.spawnChild('bug', e.x + Math.cos(a) * 40, e.y + Math.sin(a) * 40)
                }
                this.burst(e.x, e.y, e.color, 8)
              }
            }
          }
        } else {
          // 数据毁灭者：螺旋弹幕 + 数据虹吸（拉拽玩家）+ 召唤
          if (e.siphon > 0) {
            // 虹吸阶段：站定拉拽玩家，玩家可冲刺反向挣脱
            e.siphon -= dt
            const pull = 130 * dt
            const pd = Math.hypot(p.x - e.x, p.y - e.y) || 1
            p.x -= (p.x - e.x) / pd * pull
            p.y -= (p.y - e.y) / pd * pull
            this.lasers.push({ x: e.x, y: e.y, ex: p.x, ey: p.y, t: 0.05, w: 3, color: '#7c3aed' })
            if (Math.random() < 0.5) this.particles.push({ x: p.x + rand(-8, 8), y: p.y + rand(-8, 8), vx: (e.x - p.x) * 0.8, vy: (e.y - p.y) * 0.8, t: 0.3, color: '#a78bfa', size: 2 })
          } else {
            e.x += dx / d * spd * 0.8 * dt
            e.y += dy / d * spd * 0.8 * dt
            e.bossSkillT = (e.bossSkillT === undefined ? 3 : e.bossSkillT) - dt
            if (e.bossSkillT <= 0) {
              e.bossSkillT = 4.5
              e.bossPhase = ((e.bossPhase || 0) + 1) % 3
              if (e.bossPhase === 0) {
                // 螺旋弹幕：3 波旋转放射弹
                for (let wave = 0; wave < 3; wave++) {
                  for (let k = 0; k < 8; k++) {
                    const a = (k / 8) * TAU + wave * 0.26 + this.time
                    this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * (150 + wave * 40), vy: Math.sin(a) * (150 + wave * 40), r: 5, dmg: e.dmg * 0.45, t: 3.5 })
                  }
                }
                this.novas.push({ x: e.x, y: e.y, t: 0, dur: 0.5, radius: 80, color: e.color })
              } else if (e.bossPhase === 1) {
                // 数据虹吸：1.2s 拉拽
                e.siphon = 1.2
                this.floats.push({ x: e.x, y: e.y - e.r - 14, txt: '数据虹吸！冲刺挣脱！', t: 1.2, color: '#a78bfa', big: true })
              } else {
                // 召唤精英化小怪
                for (let k = 0; k < 4; k++) {
                  const a = Math.random() * TAU
                  this.spawnChild(k < 2 ? 'worm' : 'bug', e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50)
                }
                this.burst(e.x, e.y, e.color, 10)
              }
            }
          }
        }
      } else if (e.type === 'flanker') {
        // 侧翼包抄：绕到玩家侧后方弧线接近，不正面挤堆
        e.flankA = (e.flankA === undefined ? (Math.random() < 0.5 ? 1 : -1) : e.flankA)
        const orbit = Math.atan2(-dy, -dx) + e.flankA * 1.2
        const tx = p.x + Math.cos(orbit) * 60, ty = p.y + Math.sin(orbit) * 60
        const fdx = tx - e.x, fdy = ty - e.y
        const fd = Math.hypot(fdx, fdy) || 1
        e.x += fdx / fd * spd * dt
        e.y += fdy / fd * spd * dt
      } else if (e.type === 'kiter') {
        // 风筝射手：保持 250~350 距离，边退边射
        e.kiteT = (e.kiteT === undefined ? rand(1.5, 2.5) : e.kiteT) - dt
        if (d > 350) {
          e.x += dx / d * spd * dt
          e.y += dy / d * spd * dt
        } else if (d < 250) {
          e.x -= dx / d * spd * 0.9 * dt
          e.y -= dy / d * spd * 0.9 * dt
        } else {
          // 距离合适时横向游走
          e.x += -dy / d * spd * 0.5 * dt
          e.y += dx / d * spd * 0.5 * dt
        }
        if (e.kiteT <= 0 && d < 450) {
          e.kiteT = rand(1.8, 2.6)
          const a = Math.atan2(dy, dx)
          this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, r: 4, dmg: e.dmg * 0.55, t: 3 })
        }
      } else if (e.type === 'sniper') {
        e.shootT = (e.shootT || 0) - dt
        if (d > 300) {
          e.x += dx / d * spd * dt
          e.y += dy / d * spd * dt
        } else if (d < 220) {
          e.x -= dx / d * spd * 0.7 * dt
          e.y -= dy / d * spd * 0.7 * dt
        }
        if (e.shootT <= 0 && d < 420) {
          e.shootT = 2.2
          const a = Math.atan2(dy, dx)
          this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 4, dmg: e.dmg * 0.6, t: 3 })
        }
      } else if (e.type === 'charger') {
        // 暴力破解：蓄力后直线突进
        e.chargeT = (e.chargeT === undefined ? rand(1, 2) : e.chargeT) - dt
        if (e.charging > 0) {
          e.charging -= dt
          e.x += Math.cos(e.chargeA) * spd * 5.5 * dt
          e.y += Math.sin(e.chargeA) * spd * 5.5 * dt
          if (Math.random() < 0.5) this.particles.push({ x: e.x, y: e.y, vx: rand(-20, 20), vy: rand(-20, 20), t: 0.2, color: '#fb923c', size: 2 })
        } else {
          if (e.chargeT <= 0) {
            e.chargeT = rand(2.2, 3.2)
            e.charging = 0.55
            e.chargeA = Math.atan2(dy, dx)
          }
          e.x += dx / d * spd * dt
          e.y += dy / d * spd * dt
        }
      } else {
        // 转向惯性：限制角速度，不再瞬间掉头，高速绕圈可甩开怪群
        const ta = Math.atan2(dy, dx)
        if (e.headA === undefined) e.headA = ta
        let da = ta - e.headA
        while (da > Math.PI) da -= TAU
        while (da < -Math.PI) da += TAU
        const maxTurn = 3.2 * dt
        e.headA += Math.max(-maxTurn, Math.min(maxTurn, da))
        e.x += Math.cos(e.headA) * spd * dt
        e.y += Math.sin(e.headA) * spd * dt
      }
      // 墙体碰撞：敌人沿墙滑动（Boss 除外，Boss 挤墙而过）
      if (!e.boss) {
        const ec = this.collideWalls(e.x, e.y, e.r)
        e.x = ec.x; e.y = ec.y
      }
      if (d < e.r + p.r) this.hurtPlayer(e.dmg)
      if (e.orbitCd > 0) {
        e.orbitCd -= dt
      } else {
        for (let j = 0; j < this.orbits.length; j++) {
          const o = this.orbits[j]
          if (o.arc && o.cd > 0) continue
          let hit = false
          if (o.arc) {
            // 弧形墙段：角度 + 半径双判定
            const dx = e.x - p.x, dy = e.y - p.y
            const d = Math.hypot(dx, dy)
            if (Math.abs(d - o.radius) < o.size / 2 + e.r) {
              let da = Math.atan2(dy, dx) - o.a
              while (da > Math.PI) da -= TAU
              while (da < -Math.PI) da += TAU
              if (Math.abs(da) < o.arc / 2 + Math.atan2(e.r, d || 1)) hit = true
            }
          } else {
            const rr = e.r + o.size * 0.6
            if (dist2(e.x, e.y, o.x, o.y) < rr * rr) hit = true
          }
          if (hit) {
            this.dealDamage(e, o.dmg)
            if (o.arc) this.wallCds[o.key] = 3 - ((this.player.weapons.firewall || 1) >= 4 ? 1 : 0)
            // 击退：把故障推离玩家
            const kx = e.x - p.x, ky = e.y - p.y
            const kd = Math.hypot(kx, ky) || 1
            if (!e.boss && e.type !== 'tank') { e.x += kx / kd * 24; e.y += ky / kd * 24 }
            e.orbitCd = 0.4
            break
          }
        }
      }
    }
    this.enemies = this.enemies.filter(e => {
      if (e.dead) { this.pool.enemy.put(e); return false }
      return true
    })
  }

  updateBullets(dt) {
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i]
      if (b.dead) continue
      b.life -= dt
      if (b.life <= 0) { b.dead = true; continue }
      if (b.homing) {
        if (!b.target || b.target.dead) b.target = this.nearestEnemy(b.x, b.y)
        if (b.target) {
          const a = Math.atan2(b.target.y - b.y, b.target.x - b.x)
          let da = a - b.a
          while (da > Math.PI) da -= TAU
          while (da < -Math.PI) da += TAU
          b.a += Math.max(-6 * dt, Math.min(6 * dt, da))
        }
        b.vx = Math.cos(b.a) * b.speed
        b.vy = Math.sin(b.a) * b.speed
      }
      b.x += b.vx * dt
      b.y += b.vy * dt
      // 子弹撞墙湮灭
      if (this.pointInWall(b.x, b.y)) {
        this.particles.push({ x: b.x, y: b.y, vx: rand(-30, 30), vy: rand(-30, 30), t: 0.15, color: b.color, size: 2 })
        b.dead = true; continue
      }
      const near = this.hash.query(b.x, b.y, 40)
      for (let j = 0; j < near.length; j++) {
        const e = near[j]
        if (e.dead) continue
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
          this.dealDamage(e, b.dmg)
          // 感电连锁：命中后跳跃至邻近敌人
          if (b.shock && !b.shocked) {
            b.shocked = true
            const near2 = this.hash.query(e.x, e.y, 120)
            let chained = 0
            for (let k = 0; k < near2.length && chained < 2; k++) {
              const e2 = near2[k]
              if (e2 === e || e2.dead) continue
              if (dist2(e.x, e.y, e2.x, e2.y) < 120 * 120) {
                this.dealDamage(e2, b.dmg * 0.6)
                this.lasers.push({ x: e.x, y: e.y, ex: e2.x, ey: e2.y, t: 0.15, w: 2, color: '#6ee7b7' })
                chained++
              }
            }
          }
          b.pierce--
          if (b.pierce <= 0) { b.dead = true; break }
        }
      }
    }
    this.bullets = this.bullets.filter(b => {
      if (b.dead) { this.pool.bullet.put(b); return false }
      return true
    })
  }

  updateGems(dt) {
    const p = this.player
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i]
      const d2 = dist2(g.x, g.y, p.x, p.y)
      if (g.mag || d2 < p.pickup * p.pickup) {
        const d = Math.sqrt(d2) || 1
        const sp = g.mag ? 640 : 320
        g.x += (p.x - g.x) / d * sp * dt
        g.y += (p.y - g.y) / d * sp * dt
      }
      if (d2 < 18 * 18) { g.got = true; sound.play('pickup'); this.addXp(this.event === 'doublexp' ? g.v * 2 : g.v) }
    }
    this.gems = this.gems.filter(g => !g.got)
    // 金币：吸附拾取
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i]
      const cd2 = dist2(c.x, c.y, p.x, p.y)
      if (cd2 < p.pickup * p.pickup) {
        const cd = Math.sqrt(cd2) || 1
        c.x += (p.x - c.x) / cd * 380 * dt
        c.y += (p.y - c.y) / cd * 380 * dt
      }
      if (cd2 < 18 * 18) {
        c.got = true
        this.gold += this.greed ? 2 : 1
        sound.play('pickup')
      }
    }
    this.coins = this.coins.filter(c => !c.got)
    for (let i = 0; i < this.chests.length; i++) {
      const c = this.chests[i]
      if (dist2(c.x, c.y, p.x, p.y) < 26 * 26) {
        c.got = true
        sound.play('levelup')
        this.state = 'chest'
        this.cb.onChest && this.cb.onChest(this.rollChoices())
      }
    }
    this.chests = this.chests.filter(c => !c.got)
    for (let i = 0; i < this.pickups.length; i++) {
      const u = this.pickups[i]
      if (dist2(u.x, u.y, p.x, p.y) < 22 * 22) {
        u.got = true
        this.applyPickup(u.type)
      }
    }
    this.pickups = this.pickups.filter(u => !u.got)
  }

  updateFx(dt) {
    if (this.flash > 0) this.flash -= dt
    // 敌方弹幕：移动 + 命中玩家
    const pl = this.player
    for (let i = 0; i < this.ebullets.length; i++) {
      const eb = this.ebullets[i]
      eb.t -= dt
      eb.x += eb.vx * dt
      eb.y += eb.vy * dt
      if (pl && dist2(eb.x, eb.y, pl.x, pl.y) < (pl.r + eb.r) * (pl.r + eb.r)) {
        this.hurtPlayer(eb.dmg)
        eb.t = 0
      }
    }
    this.ebullets = this.ebullets.filter(eb => eb.t > 0)
    if (this.bossWarn > 0) this.bossWarn -= dt
    // 低血量心跳：HP<30% 时红边脉冲 + 心跳音效
    const p = this.player
    if (p && this.state === 'playing' && p.hp < p.maxHp * 0.3) {
      this.hbT -= dt
      if (this.hbT <= 0) {
        this.hbT = 0.8
        sound.play('heartbeat')
      }
    }
    for (let i = 0; i < this.dashTrail.length; i++) this.dashTrail[i].t -= dt
    this.dashTrail = this.dashTrail.filter(d => d.t > 0)
    for (let i = 0; i < this.rains.length; i++) {
      const r = this.rains[i]
      r.t -= dt
      if (r.t <= 0) {
        for (let j = 0; j < this.enemies.length; j++) {
          const e = this.enemies[j]
          if (!e.dead && dist2(e.x, e.y, r.x, r.y) < (r.radius + e.r) * (r.radius + e.r)) this.dealDamage(e, r.dmg)
        }
        this.novas.push({ x: r.x, y: r.y, t: 0, dur: 0.35, radius: r.radius, color: r.color })
        this.burst(r.x, r.y, r.color, 8)
      }
    }
    this.rains = this.rains.filter(r => r.t > 0)
    for (let i = 0; i < this.novas.length; i++) this.novas[i].t += dt
    this.novas = this.novas.filter(n => n.t < n.dur)
    for (let i = 0; i < this.lasers.length; i++) this.lasers[i].t -= dt
    this.lasers = this.lasers.filter(l => l.t > 0)
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i]
      pt.t -= dt
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
    }
    this.particles = this.particles.filter(pt => pt.t > 0)
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i]
      f.t -= dt
      f.y -= 30 * dt
    }
    this.floats = this.floats.filter(f => f.t > 0)
  }

  // ---------- 战斗结算 ----------

  dealDamage(e, base) {
    if (e.dead) return
    const p = this.player
    let d = base * p.dmgMul * (this.glass ? 1.5 : 1)
    const crit = Math.random() < p.crit
    if (crit) d *= 2
    e.hp -= d
    e.flashT = 0.08
    sound.play('hit')
    if (crit) {
      this.hitStop = 0.02
      this.floats.push({ x: e.x + rand(-6, 6), y: e.y - e.r, txt: String(d | 0) + '!', t: 0.8, color: '#fde047', big: true, huge: d >= 100 })
    } else {
      this.floats.push({ x: e.x + rand(-6, 6), y: e.y - e.r, txt: String(d | 0), t: 0.7, color: '#e2e8f0' })
    }
    if (e.hp <= 0) this.killEnemy(e)
  }

  killEnemy(e) {
    if (e.dead) return
    e.dead = true
    this.kills++
    this.combo++
    this.comboT = 3
    if (this.combo > this.maxCombo) this.maxCombo = this.combo
    // 狂暴时刻：连杀 30/50 触发 8 秒全武器射速翻倍
    if ((this.combo === 30 || this.combo === 50) && this.overdrive <= 0) {
      this.overdrive = 8
      this.floats.push({ x: this.player.x, y: this.player.y - 50, txt: '⚡ 狂暴时刻！火力全开！', t: 2, color: '#fde047', big: true })
      sound.play('bosskill')
      this.shakeT = this.time + 0.3
    }
    // 连杀大字提示
    if (this.combo > 0 && this.combo % 25 === 0) {
      this.floats.push({ x: this.player.x, y: this.player.y - 70, txt: 'x' + this.combo + ' COMBO', t: 1.4, color: '#fde047', big: true, huge: this.combo % 100 === 0 })
    }
    // root 权限道具：Boss/精英概率掉落
    if ((e.boss || e.elite) && Math.random() < (e.boss ? 0.8 : 0.25)) {
      this.pickups.push({ x: e.x + rand(-8, 8), y: e.y + rand(-8, 8), type: 'root' })
    }
    this.burst(e.x, e.y, e.color, e.boss ? 24 : 6)
    // 击杀冲击波
    this.novas.push({ x: e.x, y: e.y, t: 0, dur: 0.22, radius: e.boss ? 90 : 26, color: '#e2e8f0' })
    if (e.boss) {
      this.slowmo = 0.5
      this.zoomT = 0.25
      sound.play('bosskill')
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * TAU, d = rand(10, 60)
        this.gems.push({ x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, v: Math.ceil(e.xp / 12) })
      }
      if (e.type === 'data_destroyer') {
        this.state = 'win'
        this.achv.win = true
        sound.play('win')
        this.cb.onEnd && this.cb.onEnd({ win: true, time: this.time, kills: this.kills, level: this.player.level })
        return
      }
    } else if (e.elite) {
      this.chests.push({ x: e.x, y: e.y })
      this.burst(e.x, e.y, '#fde047', 16)
    } else {
      const bonus = 1 + Math.min(this.combo, 50) * 0.01
      this.gems.push({ x: e.x, y: e.y, v: Math.ceil(e.xp * bonus) })
      // 金币掉落：诅咒提高掉率与数量
      const goldChance = 0.12 + this.curse * 0.06
      if (Math.random() < goldChance) {
        const n = 1 + (Math.random() < this.curse * 0.15 ? 1 : 0)
        for (let i = 0; i < n; i++) this.coins.push({ x: e.x + rand(-10, 10), y: e.y + rand(-10, 10) })
      }
      if (e.gold) {
        this.chests.push({ x: e.x, y: e.y })
        this.burst(e.x, e.y, '#fde047', 12)
        this.floats.push({ x: e.x, y: e.y - 20, txt: '稀有故障！', t: 1.2, color: '#fde047', big: true })
      }
      if (e.type === 'splitter' && !e.child) {
        for (let i = 0; i < 2; i++) this.spawnChild('bug', e.x + rand(-14, 14), e.y + rand(-14, 14))
      }
      if (Math.random() < 0.012) this.dropPickup(e.x, e.y)
    }
    // 缓存冲击：击杀时概率触发
    const clv = this.player.weapons.cache
    if (clv) {
      const w = WEAPONS.cache
      const chance = w.chance + (clv - 1) * 0.06
      if (Math.random() < chance) {
        const radius = w.radius + (clv >= 3 ? 20 : 0)
        const dmg = w.dmg * (1 + (clv - 1) * 0.3)
        for (let i = 0; i < this.enemies.length; i++) {
          const t = this.enemies[i]
          if (!t.dead && dist2(t.x, t.y, e.x, e.y) < (radius + t.r) * (radius + t.r)) this.dealDamage(t, dmg)
        }
        this.novas.push({ x: e.x, y: e.y, t: 0, dur: 0.35, radius, color: w.color })
      }
    }
  }

  hurtPlayer(dmg) {
    const p = this.player
    if (p.invuln > 0 || this.state !== 'playing') return
    const d = Math.max(1, dmg * (1 - p.armor) * (1 + this.curse * 0.12) * (this.glass ? 2 : 1))
    p.hp -= d
    p.invuln = 0.6
    this.shakeT = this.time + 0.3
    this.flash = 0.5
    sound.play('hurt')
    this.floats.push({ x: p.x, y: p.y - 16, txt: '-' + String(d | 0), t: 0.7, color: '#f87171' })
    if (p.hp <= 0) {
      // 备份恢复：分身牺牲自己替玩家挡下致命伤害
      if (this.clones.length > 0 && this.cloneReviveT <= 0) {
        this.clones.pop()
        this.cloneReviveT = 90
        p.hp = p.maxHp * 0.3
        p.invuln = 1.5
        this.floats.push({ x: p.x, y: p.y - 50, txt: '★ 备份恢复成功！分身牺牲，恢复 30% 生命', t: 2.5, color: '#e879f9', big: true })
        this.novas.push({ x: p.x, y: p.y, t: 0, dur: 0.5, radius: 120, color: '#e879f9' })
        this.burst(p.x, p.y, '#e879f9', 16)
        this.slowmo = 0.5
        sound.play('bosskill')
        return
      }
      p.hp = 0
      this.state = 'over'
      sound.play('over')
      this.cb.onEnd && this.cb.onEnd({ win: false, time: this.time, kills: this.kills, level: p.level })
    }
  }

  addXp(n) {
    const p = this.player
    p.xp += n
    if (p.xp >= p.xpNeed && this.state === 'playing') {
      p.xp -= p.xpNeed
      p.level++
      p.xpNeed = XP_CURVE(p.level)
      this.state = 'levelup'
      sound.play('levelup')
      this.cb.onLevelUp && this.cb.onLevelUp(this.rollChoices())
    }
  }

  rollChoices() {
    const p = this.player
    const pool = []
    const wIds = Object.keys(p.weapons)
    for (let i = 0; i < wIds.length; i++) {
      const id = wIds[i]
      const w = WEAPONS[id]
      if (p.weapons[id] < w.maxLv) {
        pool.push({ kind: 'weapon', id, name: w.name, lv: p.weapons[id] + 1, desc: w.up[p.weapons[id] - 1] || '强化', color: w.color })
      } else if (EVOLUTIONS[id] && !p.evolutions[id]) {
        const ev = EVOLUTIONS[id]
        pool.push({ kind: 'evolve', id, name: '进化：' + ev.name, lv: 6, desc: ev.desc, color: ev.color })
      }
    }
    if (wIds.length < 6) {
      for (const id in WEAPONS) {
        if (!p.weapons[id]) {
          const w = WEAPONS[id]
          pool.push({ kind: 'new', id, name: w.name, lv: 1, desc: w.desc, color: w.color })
        }
      }
    }
    for (const id in PASSIVES) {
      const s = PASSIVES[id]
      const cur = p.passives[id] || 0
      if (cur < s.maxLv) {
        pool.push({ kind: 'passive', id, name: s.name, lv: cur + 1, desc: s.desc, color: s.color })
      }
    }
    const out = []
    while (out.length < 3 && pool.length) {
      out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0])
    }
    return out
  }

  chooseUpgrade(c) {
    const p = this.player
    if (c.kind === 'new') p.weapons[c.id] = 1
    else if (c.kind === 'evolve') {
      p.evolutions[c.id] = true
      this.floats.push({ x: p.x, y: p.y - 40, txt: '★ ' + EVOLUTIONS[c.id].name + ' 进化完成！', t: 2, color: EVOLUTIONS[c.id].color, big: true })
      sound.play('bosskill')
    }
    else if (c.kind === 'weapon') p.weapons[c.id] = (p.weapons[c.id] || 0) + 1
    else {
      p.passives[c.id] = (p.passives[c.id] || 0) + 1
      this.recalc()
    }
    if (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed
      p.level++
      p.xpNeed = XP_CURVE(p.level)
      this.cb.onLevelUp && this.cb.onLevelUp(this.rollChoices())
      return
    }
    this.state = 'playing'
  }

  dash() {
    if (this.state !== 'playing' || this.dashCd > 0) return
    this.dashCd = 3
    this.dashT = 0.18
    this.player.invuln = Math.max(this.player.invuln, 0.3)
    // 起冲脉冲环 + 爆发粒子
    this.novas.push({ x: this.player.x, y: this.player.y, t: 0, dur: 0.3, radius: 60, color: '#22d3ee' })
    this.burst(this.player.x, this.player.y, '#67e8f9', 10)
    sound.play('shoot')
  }
  // ---------- 全屏必杀技：rm -rf ----------
  useUlt() {
    if (this.state !== 'playing' || this.rootCharges <= 0) return false
    this.rootCharges--
    this.ultT = 1.2
    this.slowmo = 1.0
    this.shakeT = this.time + 0.5
    this.zoomT = 0.25
    const dmg = 260 * (1 + this.time / 60)
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (!e.dead) this.dealDamage(e, e.boss ? dmg * 1.5 : dmg)
    }
    this.novas.push({ x: this.player.x, y: this.player.y, t: 0, dur: 0.9, radius: 900, color: '#f0abfc' })
    this.burst(this.player.x, this.player.y, '#f0abfc', 24)
    this.floats.push({ x: this.player.x, y: this.player.y - 60, txt: 'rm -rf /* 执行完成', t: 1.6, color: '#f0abfc', big: true })
    sound.play('bosskill')
    return true
  }

  // 鼠标瞄准：记录屏幕坐标（准星渲染 + 主炮方向）
  aim(sx, sy) {
    this.mouse.x = sx
    this.mouse.y = sy
  }

  screenToWorld(x, y) {
    const p = this.player
    if (!p) return { x: 0, y: 0 }
    return { x: p.x + (x - this.W / 2), y: p.y + (y - this.H / 2) }
  }

  nearestEnemy(x, y) {
    let best = null, bd = Infinity
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead) continue
      const d = dist2(x, y, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  burst(x, y, color, n) {
    if (this.enemies.length > 300) n = Math.ceil(n / 2)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU
      const s = rand(60, 200)
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0.3, 0.6), color, size: rand(2, 4) })
    }
  }

  statsTick(dt) {
    this.statT += dt
    if (this.statT < 0.15) return
    this.statT = 0
    const p = this.player
    if (!p || !this.cb.onStats) return
    // 成就检测
    const newAchv = []
    if (this.kills >= 100 && !this.achv.k100) { this.achv.k100 = true; newAchv.push('百人斩：累计击杀 100') }
    if (this.kills >= 500 && !this.achv.k500) { this.achv.k500 = true; newAchv.push('五百人斩：累计击杀 500') }
    if (this.time >= 600 && !this.achv.t10) { this.achv.t10 = true; newAchv.push('坚壁清野：存活 10 分钟') }
    if (this.achv.win && !this.achv.winned) { this.achv.winned = true; newAchv.push('数据守护者：击败数据毁灭者') }
    if (this.maxCombo >= 50 && !this.achv.c50) { this.achv.c50 = true; newAchv.push('连锁反应：单局连杀 50') }
    if (this.synergies && this.synergies.length >= 3 && !this.achv.syn3) { this.achv.syn3 = true; newAchv.push('架构师：同时激活 3 条武器协同') }
    if (this.gold >= 100 && !this.achv.g100) { this.achv.g100 = true; newAchv.push('财富自由：单局持有 100 金币') }
    if (this.curse >= 5 && !this.achv.curse5) { this.achv.curse5 = true; newAchv.push('与魔共舞：叠加 5 层黑暗契约') }
    if (this.rootCharges >= 3 && !this.achv.root3) { this.achv.root3 = true; newAchv.push('root 大师：同时持有 3 次 root 权限') }
    for (let i = 0; i < newAchv.length; i++) {
      this.floats.push({ x: p.x, y: p.y - 70 - i * 22, txt: '🏆 ' + newAchv[i], t: 3, color: '#fde047', big: true })
      sound.play('levelup')
    }
    this.cb.onStats({
      hp: p.hp, maxHp: p.maxHp, level: p.level, xp: p.xp, xpNeed: p.xpNeed,
      time: this.time, kills: this.kills, state: this.state, combo: this.combo, dashCd: Math.max(0, this.dashCd), event: this.event, eventT: Math.max(0, this.eventT),
      weapons: Object.assign({}, p.weapons), passives: Object.assign({}, p.passives), evolutions: Object.assign({}, p.evolutions),
      gold: this.gold, curse: this.curse, shopIn: Math.max(0, this.shopTimer),
      overdrive: Math.max(0, this.overdrive), rootCharges: this.rootCharges, huntT: this.hunt ? Math.max(0, this.hunt.t) : 0
    })
  }

  // ---------- 渲染 ----------

  render() {
    const ctx = this.ctx
    const p = this.player
    if (!p) return
    let camX = p.x - this.W / 2
    let camY = p.y - this.H / 2
    if (this.time < this.shakeT) {
      const s = 8 * (this.shakeT - this.time) / 0.3
      camX += rand(-s, s)
      camY += rand(-s, s)
    }
    // 背景
    ctx.fillStyle = '#0d1526'
    ctx.fillRect(0, 0, this.W, this.H)
    // 网格
    ctx.strokeStyle = 'rgba(94,140,220,0.35)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    const g = 64
    const ox = -((camX % g) + g) % g
    const oy = -((camY % g) + g) % g
    for (let x = ox; x < this.W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, this.H) }
    for (let y = oy; y < this.H; y += g) { ctx.moveTo(0, y); ctx.lineTo(this.W, y) }
    ctx.stroke()
    // 视差星尘：随镜头慢速漂移，营造空间深度
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i]
      const sx = ((s.x * this.W - camX * s.d) % this.W + this.W) % this.W
      const sy = ((s.y * this.H - camY * s.d) % this.H + this.H) % this.H
      ctx.globalAlpha = s.a
      ctx.fillStyle = '#a5b4d4'
      ctx.fillRect(sx, sy, s.s, s.s)
    }
    ctx.globalAlpha = 1

    ctx.save()
    ctx.translate(-camX, -camY)

    // 毒沼：绿色腐蚀区域（危险地形）
    // 内存泄漏巨兽毒迹：青色泄漏池（Boss 留下，站入掉血）
    for (let i = 0; i < this.leakPools.length; i++) {
      const lp = this.leakPools[i]
      const k = Math.min(1, lp.t / 4)
      const g = ctx.createRadialGradient(lp.x, lp.y, lp.r * 0.15, lp.x, lp.y, lp.r)
      g.addColorStop(0, 'rgba(6,182,212,' + (0.35 * k).toFixed(2) + ')')
      g.addColorStop(1, 'rgba(8,51,68,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(lp.x, lp.y, lp.r, 0, TAU)
      ctx.fill()
      if (Math.random() < 0.1) this.particles.push({ x: lp.x + rand(-lp.r, lp.r) * 0.5, y: lp.y + rand(-lp.r, lp.r) * 0.5, vx: 0, vy: -rand(8, 24), t: 0.4, color: '#22d3ee', size: 1.5 })
    }
    for (let i = 0; i < this.swamps.length; i++) {
      const s = this.swamps[i]
      const g = ctx.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r)
      g.addColorStop(0, 'rgba(163,230,53,0.30)')
      g.addColorStop(1, 'rgba(101,163,13,0.05)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, TAU)
      ctx.fill()
      if (Math.random() < 0.15) this.particles.push({ x: s.x + rand(-s.r, s.r) * 0.7, y: s.y + rand(-s.r, s.r) * 0.7, vx: 0, vy: -rand(10, 30), t: 0.5, color: '#a3e635', size: 2 })
    }
    // 可交互物件：电容 / 水晶 / EMP 塔
    for (let i = 0; i < this.props.length; i++) {
      const c = this.props[i]
      ctx.save()
      ctx.translate(c.x, c.y)
      if (c.kind === 'capacitor') {
        const blink = c.fuse > 0 && Math.sin(this.time * 40) > 0
        ctx.fillStyle = blink ? '#fff' : '#fb923c'
        ctx.fillRect(-6, -9, 12, 18)
        ctx.fillStyle = '#7c2d12'
        ctx.fillRect(-6, -9, 12, 4)
        ctx.fillRect(-6, 5, 12, 4)
        ctx.shadowColor = '#fb923c'
        ctx.shadowBlur = 8
        ctx.strokeStyle = '#fdba74'
        ctx.lineWidth = 1.5
        ctx.strokeRect(-6, -9, 12, 18)
      } else if (c.kind === 'crystal') {
        ctx.rotate(this.time * 0.8)
        ctx.shadowColor = '#22d3ee'
        ctx.shadowBlur = 10
        ctx.fillStyle = '#22d3ee'
        ctx.beginPath()
        ctx.moveTo(0, -11)
        ctx.lineTo(8, 0)
        ctx.lineTo(0, 11)
        ctx.lineTo(-8, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.beginPath()
        ctx.moveTo(0, -11)
        ctx.lineTo(4, 0)
        ctx.lineTo(0, 0)
        ctx.closePath()
        ctx.fill()
      } else if (c.kind === 'emp') {
        ctx.fillStyle = '#1e3a5f'
        ctx.fillRect(-5, -12, 10, 24)
        ctx.fillStyle = '#60a5fa'
        ctx.fillRect(-5, -12, 10, 5)
        const charge = 1 - Math.min(1, c.pulseT / 5)
        ctx.strokeStyle = 'rgba(96,165,250,' + (0.2 + charge * 0.5).toFixed(2) + ')'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 0, 16 + charge * 6, 0, TAU)
        ctx.stroke()
      }
      ctx.restore()
    }
    // 经验宝石
    for (let i = 0; i < this.gems.length; i++) {
      const gm = this.gems[i]
      ctx.fillStyle = '#2dd4bf'
      ctx.save()
      ctx.translate(gm.x, gm.y)
      ctx.rotate(this.time * 2)
      ctx.fillRect(-3, -3, 6, 6)
      ctx.restore()
    }

    // 落雷预警
    for (let i = 0; i < this.rains.length; i++) {
      const r = this.rains[i]
      ctx.strokeStyle = r.color
      ctx.setLineDash([6, 6])
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.radius, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    // 敌人
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      ctx.save()
      ctx.translate(e.x, e.y)
      // 精英词缀光环：词缀颜色外圈
      if (e.elite && e.affixColor) {
        ctx.save()
        ctx.globalAlpha = 0.5 + 0.2 * Math.sin(this.time * 5)
        ctx.strokeStyle = e.affixColor
        ctx.lineWidth = 2
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.arc(0, 0, e.r + 6, this.time * 2, this.time * 2 + TAU)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
      // 自爆程序：引信闪烁预警圈
      if (e.type === 'bomber' && e.fuseT > 0) {
        ctx.save()
        ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(this.time * 20))
        ctx.strokeStyle = '#fca5a5'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 0, 70, 0, TAU)
        ctx.stroke()
        ctx.restore()
      }
      // 身体呼吸脉动
      const br = 1 + 0.06 * Math.sin(this.time * 6 + e.x * 0.1)
      ctx.rotate(this.time * (e.boss ? 0.5 : 1.5))
      ctx.shadowColor = e.color
      ctx.shadowBlur = e.boss ? 24 : (e.elite ? 16 : 8)
      ctx.strokeStyle = e.color
      ctx.lineWidth = 2
      drawShape(ctx, e.shape, e.r * br)
      ctx.stroke()
      ctx.fillStyle = e.color + '33'
      ctx.fill()
      // 受击闪白
      if (e.flashT > 0) {
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.fill()
      }
      ctx.restore()
      // 怪物之眼：朝向玩家的双眼（不随身体旋转；Boss 独眼怒视）
      ctx.save()
      ctx.translate(e.x, e.y)
      const ea = Math.atan2(p.y - e.y, p.x - e.x)
      if (e.boss) {
        ctx.shadowColor = '#fff'
        ctx.shadowBlur = 10
        ctx.fillStyle = '#fca5a5'
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.3, 0, TAU); ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = '#450a0a'
        ctx.beginPath(); ctx.arc(Math.cos(ea) * e.r * 0.08, Math.sin(ea) * e.r * 0.08, e.r * 0.14, 0, TAU); ctx.fill()
      } else {
        const ex = Math.cos(ea), ey = Math.sin(ea)
        for (let s = -1; s <= 1; s += 2) {
          const ox = ex * 2 - ey * s * e.r * 0.34
          const oy = ey * 2 + ex * s * e.r * 0.34
          ctx.fillStyle = '#fff'
          ctx.beginPath(); ctx.arc(ox, oy, e.r * 0.24, 0, TAU); ctx.fill()
          ctx.fillStyle = '#111'
          ctx.beginPath(); ctx.arc(ox + ex * e.r * 0.09, oy + ey * e.r * 0.09, e.r * 0.12, 0, TAU); ctx.fill()
        }
      }
      // 类型特征细节
      if (e.type === 'healer') {
        ctx.strokeStyle = '#dcfce7'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke()
      } else if (e.type === 'tank') {
        ctx.fillStyle = '#cbd5e1'
        for (let s = -1; s <= 1; s += 2) {
          ctx.beginPath(); ctx.arc(s * e.r * 0.45, 0, 2, 0, TAU); ctx.fill()
          ctx.beginPath(); ctx.arc(0, s * e.r * 0.45, 2, 0, TAU); ctx.fill()
        }
      } else if (e.type === 'bomber') {
        ctx.fillStyle = '#fde047'
        ctx.beginPath(); ctx.arc(0, -e.r - 3, 2 + Math.abs(Math.sin(this.time * 12)) * 2, 0, TAU); ctx.fill()
      } else if (e.type === 'sniper' || e.type === 'kiter') {
        ctx.strokeStyle = 'rgba(34,211,238,0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 6])
        ctx.beginPath(); ctx.moveTo(Math.cos(ea) * e.r, Math.sin(ea) * e.r); ctx.lineTo(Math.cos(ea) * 90, Math.sin(ea) * 90); ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.restore()
      if (e.hp < e.maxHp && !e.boss) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(e.x - e.r, e.y - e.r - 8, e.r * 2, 3)
        ctx.fillStyle = '#f87171'
        ctx.fillRect(e.x - e.r, e.y - e.r - 8, e.r * 2 * (e.hp / e.maxHp), 3)
      }
    }

    // 子弹
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i]
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(b.a)
      ctx.shadowColor = b.color
      ctx.shadowBlur = 8
      ctx.fillStyle = b.color
      ctx.beginPath()
      ctx.moveTo(6, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // 敌方弹幕
    for (let i = 0; i < this.ebullets.length; i++) {
      const eb = this.ebullets[i]
      ctx.save()
      ctx.shadowColor = '#22d3ee'
      ctx.shadowBlur = 8
      ctx.fillStyle = '#22d3ee'
      ctx.beginPath()
      ctx.arc(eb.x, eb.y, eb.r, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    // 环绕武器
    for (let i = 0; i < this.orbits.length; i++) {
      const o = this.orbits[i]
      if (o.arc) {
        // 弧形防护墙：发光弧线墙体 + 内芯提亮
        ctx.save()
        ctx.globalAlpha = o.cd > 0 ? 0.22 : 1
        ctx.shadowColor = o.color
        ctx.shadowBlur = o.cd > 0 ? 4 : 14
        ctx.strokeStyle = o.color
        ctx.lineWidth = o.size
        ctx.beginPath()
        ctx.arc(p.x, p.y, o.radius, o.a - o.arc / 2, o.a + o.arc / 2)
        ctx.stroke()
        ctx.globalAlpha = o.cd > 0 ? 0.1 : 0.35
        ctx.strokeStyle = '#e0f2fe'
        ctx.lineWidth = o.size * 0.4
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.restore()
      } else {
        ctx.save()
        ctx.translate(o.x, o.y)
        ctx.rotate(this.time * 3)
        ctx.shadowColor = o.color
        ctx.shadowBlur = 12
        ctx.strokeStyle = o.color
        ctx.lineWidth = 2
        ctx.strokeRect(-o.size / 2, -o.size / 2, o.size, o.size)
        ctx.fillStyle = o.color + '44'
        ctx.fillRect(-o.size / 2, -o.size / 2, o.size, o.size)
        ctx.restore()
      }
    }

    // 光束
    for (let i = 0; i < this.lasers.length; i++) {
      const l = this.lasers[i]
      ctx.globalAlpha = Math.max(0, l.t / 0.25)
      ctx.strokeStyle = l.color
      ctx.shadowColor = l.color
      ctx.shadowBlur = 12
      ctx.lineWidth = l.w
      ctx.beginPath()
      ctx.moveTo(l.x, l.y)
      ctx.lineTo(l.ex, l.ey)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }

    // 环形脉冲
    for (let i = 0; i < this.novas.length; i++) {
      const n = this.novas[i]
      const k = n.t / n.dur
      ctx.globalAlpha = 1 - k
      ctx.strokeStyle = n.color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.radius * k, 0, TAU)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // 金币
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i]
      ctx.save()
      ctx.shadowColor = '#fde047'
      ctx.shadowBlur = 8
      ctx.fillStyle = '#fde047'
      ctx.beginPath()
      ctx.arc(c.x, c.y, 3.5, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#fef9c3'
      ctx.beginPath()
      ctx.arc(c.x, c.y, 1.5, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    // 掉落物（治疗/磁铁/炸弹）
    for (let i = 0; i < this.pickups.length; i++) {
      const u = this.pickups[i]
      const pulse = 1 + Math.sin(this.time * 6) * 0.15
      ctx.save()
      ctx.translate(u.x, u.y)
      ctx.scale(pulse, pulse)
      if (u.type === 'heal') {
        ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 14
        ctx.fillStyle = '#4ade80'
        ctx.fillRect(-8, -8, 16, 16)
        ctx.fillStyle = '#052e16'
        ctx.fillRect(-2, -6, 4, 12)
        ctx.fillRect(-6, -2, 12, 4)
      } else if (u.type === 'magnet') {
        ctx.shadowColor = '#60a5fa'; ctx.shadowBlur = 14
        ctx.strokeStyle = '#60a5fa'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(0, 0, 7, Math.PI, 0)
        ctx.stroke()
        ctx.fillStyle = '#60a5fa'
        ctx.fillRect(-9, 0, 4, 6)
        ctx.fillRect(5, 0, 4, 6)
      } else {
        ctx.shadowColor = '#fb7185'; ctx.shadowBlur = 14
        ctx.fillStyle = '#fb7185'
        ctx.beginPath()
        ctx.arc(0, 2, 8, 0, TAU)
        ctx.fill()
        ctx.strokeStyle = '#fde047'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, -6)
        ctx.lineTo(5, -11)
        ctx.stroke()
      }
      ctx.restore()
    }

    // Boss 冲锋预警线：内核恐慌蓄力时显示红色冲刺路径
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      if (e.dead || !e.boss || !(e.telegraph > 0)) continue
      const a = Math.atan2(this.player.y - e.y, this.player.x - e.x)
      ctx.save()
      ctx.translate(e.x, e.y)
      ctx.rotate(a)
      const blink = 0.35 + 0.3 * Math.sin(this.time * 25)
      ctx.fillStyle = 'rgba(220,38,38,' + blink.toFixed(2) + ')'
      ctx.fillRect(0, -e.r * 0.7, 520, e.r * 1.4)
      ctx.restore()
    }
    // 宝箱
    for (let i = 0; i < this.chests.length; i++) {
      const c = this.chests[i]
      const pulse = 1 + Math.sin(this.time * 5) * 0.12
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.scale(pulse, pulse)
      ctx.shadowColor = '#fde047'
      ctx.shadowBlur = 18
      ctx.strokeStyle = '#fde047'
      ctx.lineWidth = 2
      ctx.strokeRect(-9, -7, 18, 14)
      ctx.fillStyle = 'rgba(253,224,71,0.25)'
      ctx.fillRect(-9, -7, 18, 14)
      ctx.beginPath()
      ctx.moveTo(-9, -1); ctx.lineTo(9, -1)
      ctx.stroke()
      ctx.restore()
    }

    // 冲刺残影
    for (let i = 0; i < this.dashTrail.length; i++) {
      const d = this.dashTrail[i]
      const k = d.t / 0.35
      ctx.globalAlpha = k * 0.45
      ctx.fillStyle = '#22d3ee'
      ctx.beginPath()
      ctx.arc(d.x, d.y, p.r * (0.4 + k * 0.6), 0, TAU)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // 玩家：能量核心造型（外辉光 + 主体 + 内核 + 旋转能量弧）
    // 备份分身：玩家缩小克隆体（紫色，跟随作战）
    for (let i = 0; i < this.clones.length; i++) {
      const c = this.clones[i]
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.shadowColor = '#e879f9'
      ctx.shadowBlur = 12
      ctx.fillStyle = '#86198f'
      ctx.beginPath()
      ctx.arc(0, 0, 8, 0, TAU)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = '#e879f9'
      ctx.beginPath()
      ctx.arc(0, 0, 5.5, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#fae8ff'
      ctx.beginPath()
      ctx.arc(0, 0, 2, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    ctx.save()
    ctx.translate(p.x, p.y)
    if (p.invuln > 0 && ((this.time * 20) | 0) % 2 === 0) ctx.globalAlpha = 0.4
    ctx.shadowColor = '#22d3ee'
    ctx.shadowBlur = 18
    ctx.fillStyle = '#0e7490'
    ctx.beginPath()
    ctx.arc(0, 0, p.r, 0, TAU)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath()
    ctx.arc(0, 0, p.r - 3, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#e0f2fe'
    ctx.beginPath()
    ctx.arc(0, 0, 3.5, 0, TAU)
    ctx.fill()
    // 旋转能量弧（装饰）
    ctx.strokeStyle = 'rgba(224,242,254,0.7)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(0, 0, p.r - 1.5, this.time * 1.6, this.time * 1.6 + 1.1)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, p.r - 1.5, this.time * 1.6 + Math.PI, this.time * 1.6 + Math.PI + 1.1)
    ctx.stroke()
    // 主炮：紧凑炮身（朝鼠标方向）
    let aimA = p.face
    if (this.mouse.x || this.mouse.y) {
      aimA = Math.atan2(this.mouse.y - this.H / 2, this.mouse.x - this.W / 2)
    }
    ctx.save()
    ctx.rotate(aimA)
    ctx.fillStyle = '#164e63'
    ctx.strokeStyle = '#67e8f9'
    ctx.lineWidth = 1.5
    ctx.fillRect(p.r - 6, -3, 14, 6)
    ctx.strokeRect(p.r - 6, -3, 14, 6)
    ctx.fillStyle = '#e0f2fe'
    ctx.beginPath()
    ctx.arc(p.r + 8, 0, 1.8, 0, TAU)
    ctx.fill()
    ctx.restore()
    // 护目镜面罩：朝瞄准方向的发光眼缝（不随炮身缩放）
    ctx.save()
    ctx.rotate(aimA)
    ctx.shadowColor = '#67e8f9'
    ctx.shadowBlur = 8
    ctx.strokeStyle = '#a5f3fc'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(0, 0, p.r - 2, -0.5, 0.5)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#f0fdfa'
    ctx.beginPath()
    ctx.arc(p.r * 0.45, 0, 1.6, 0, TAU)
    ctx.fill()
    ctx.restore()
    // 推进器喷焰：移动时尾部喷射粒子尾焰
    if (this.input.x || this.input.y) {
      const ma = Math.atan2(this.input.y, this.input.x)
      ctx.save()
    ctx.rotate(ma)
      const fl = 6 + Math.abs(Math.sin(this.time * 30)) * 5
      ctx.shadowColor = '#22d3ee'
      ctx.shadowBlur = 10
      ctx.fillStyle = 'rgba(103,232,249,0.85)'
      ctx.beginPath()
      ctx.moveTo(-p.r + 2, -3)
      ctx.lineTo(-p.r - fl, 0)
      ctx.lineTo(-p.r + 2, 3)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    // 副机枪：环绕玩家的自动炮塔
    const tLv = p.weapons.turret || 0
    if (tLv > 0) {
      const tn = tLv >= 4 ? 2 : 1
      for (let i = 0; i < tn; i++) {
        const ta = this.time * 1.2 + (i * Math.PI) / tn
        ctx.save()
        ctx.translate(Math.cos(ta) * 26, Math.sin(ta) * 26)
        ctx.fillStyle = '#134e4a'
        ctx.strokeStyle = '#5eead4'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(0, 0, 4.5, 0, TAU)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
    }
    ctx.restore()

    // 粒子
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i]
      ctx.globalAlpha = Math.max(0, pt.t / 0.6)
      ctx.fillStyle = pt.color
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size)
      ctx.globalAlpha = 1
    }

    // 飘字
    ctx.textAlign = 'center'
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i]
      ctx.globalAlpha = Math.min(1, f.t / 0.3)
      ctx.fillStyle = f.color
      ctx.font = (f.huge ? 'bold 30px' : f.big ? 'bold 20px' : '12px') + ' monospace'
      ctx.fillText(f.txt, f.x, f.y)
      ctx.globalAlpha = 1
    }

    ctx.restore()

    // 渐晕暗角：聚焦画面中心
    if (this.vignette) {
      ctx.fillStyle = this.vignette
      ctx.fillRect(0, 0, this.W, this.H)
    }

    // Boss 血条（屏幕顶部）
    let boss = null
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].boss && !this.enemies[i].dead) { boss = this.enemies[i]; break }
    }
    if (boss) {
      const bw = Math.min(this.W - 80, 500)
      const bx = (this.W - bw) / 2
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(bx, 12, bw, 14)
      ctx.fillStyle = boss.color
      ctx.fillRect(bx + 2, 14, (bw - 4) * Math.max(0, boss.hp / boss.maxHp), 10)
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '12px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(ENEMIES[boss.type].name, this.W / 2, 38)
    }
    // 鼠标准星
    if (this.state === 'playing' && (this.mouse.x || this.mouse.y)) {
      ctx.strokeStyle = 'rgba(34,211,238,0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(this.mouse.x, this.mouse.y, 9, 0, TAU)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(this.mouse.x - 14, this.mouse.y); ctx.lineTo(this.mouse.x - 5, this.mouse.y)
      ctx.moveTo(this.mouse.x + 5, this.mouse.y); ctx.lineTo(this.mouse.x + 14, this.mouse.y)
      ctx.moveTo(this.mouse.x, this.mouse.y - 14); ctx.lineTo(this.mouse.x, this.mouse.y - 5)
      ctx.moveTo(this.mouse.x, this.mouse.y + 5); ctx.lineTo(this.mouse.x, this.mouse.y + 14)
      ctx.stroke()
    }

    // 受击红闪
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(239,68,68,' + (Math.min(0.5, this.flash) * 0.6).toFixed(3) + ')'
      ctx.fillRect(0, 0, this.W, this.H)
    }
    // 低血量红边脉冲
    if (p && this.state === 'playing' && p.hp < p.maxHp * 0.3) {
      const pulse = 0.25 + 0.2 * Math.sin(this.time * 7.5)
      const eg = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.38, this.W / 2, this.H / 2, Math.hypot(this.W, this.H) * 0.55)
      eg.addColorStop(0, 'rgba(239,68,68,0)')
      eg.addColorStop(1, 'rgba(239,68,68,' + pulse.toFixed(3) + ')')
      ctx.fillStyle = eg
      ctx.fillRect(0, 0, this.W, this.H)
    }
    // Boss 出场全屏警告横幅
    if (this.bossWarn > 0) {
      const k = Math.min(1, this.bossWarn / 0.4)
      ctx.save()
      ctx.globalAlpha = k
      ctx.fillStyle = 'rgba(127,29,29,0.55)'
      ctx.fillRect(0, this.H / 2 - 34, this.W, 68)
      ctx.strokeStyle = '#f87171'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, this.H / 2 - 34); ctx.lineTo(this.W, this.H / 2 - 34)
      ctx.moveTo(0, this.H / 2 + 34); ctx.lineTo(this.W, this.H / 2 + 34)
      ctx.stroke()
      ctx.fillStyle = '#fca5a5'
      ctx.font = 'bold 26px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const blink = Math.sin(this.time * 16) > -0.3
      if (blink) ctx.fillText('⚠ 检测到核心故障体 ⚠', this.W / 2, this.H / 2)
      ctx.restore()
    }
    // 狂暴时刻：屏幕边缘金色电弧
    if (this.overdrive > 0) {
      ctx.save()
      const a = 0.35 + 0.25 * Math.sin(this.time * 12)
      ctx.strokeStyle = 'rgba(253,224,71,' + a.toFixed(3) + ')'
      ctx.lineWidth = 4
      ctx.shadowColor = '#fde047'
      ctx.shadowBlur = 16
      ctx.strokeRect(3, 3, this.W - 6, this.H - 6)
      ctx.restore()
    }
    // 大招演出：rm -rf 全屏紫闪 + 大字
    if (this.ultT > 0) {
      ctx.save()
      const k = this.ultT / 1.2
      ctx.fillStyle = 'rgba(240,171,252,' + (k * 0.25).toFixed(3) + ')'
      ctx.fillRect(0, 0, this.W, this.H)
      ctx.globalAlpha = Math.min(1, k * 1.5)
      ctx.fillStyle = '#f0abfc'
      ctx.font = 'bold 42px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = '#f0abfc'
      ctx.shadowBlur = 24
      ctx.fillText('rm -rf /*', this.W / 2, this.H / 2)
      ctx.restore()
    }
    // 猎杀目标倒计时
    if (this.hunt && !this.hunt.e.dead) {
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(this.W / 2 - 110, 52, 220, 22)
      ctx.fillStyle = '#f0abfc'
      ctx.font = 'bold 13px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('🎯 猎杀目标 ' + Math.ceil(this.hunt.t) + 's', this.W / 2, 63)
      ctx.restore()
    }
    // zoom punch：击杀 Boss/释放大招时镜头快速拉近再弹回
    if (this.zoomT > 0) {
      const k = this.zoomT / 0.25
      const sc = 1 + 0.06 * k
      ctx.save()
      ctx.translate(this.W / 2, this.H / 2)
      ctx.scale(sc, sc)
      ctx.translate(-this.W / 2, -this.H / 2)
      ctx.fillStyle = 'rgba(255,255,255,' + (k * 0.08).toFixed(3) + ')'
      ctx.fillRect(0, 0, this.W, this.H)
      ctx.restore()
    }
    // Boss 二阶段红闪：血量低于 40% 时全屏红色脉冲
    let boss2 = null
    for (let bi = 0; bi < this.enemies.length; bi++) {
      const be = this.enemies[bi]
      if (be.boss && !be.dead && be.hp < be.maxHp * 0.4) { boss2 = be; break }
    }
    if (boss2) {
      const pulse = 0.10 + 0.08 * Math.sin(this.time * 9)
      ctx.fillStyle = 'rgba(239,68,68,' + pulse.toFixed(3) + ')'
      ctx.fillRect(0, 0, this.W, this.H)
    }
    // CRT 扫描线滤镜
    if (this.crt) {
      ctx.save()
      ctx.globalAlpha = 0.06
      ctx.fillStyle = '#000'
      for (let y = 0; y < this.H; y += 4) ctx.fillRect(0, y, this.W, 2)
      ctx.restore()
    }
  }
}
