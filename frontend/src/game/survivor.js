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
    desc: '环绕机身的防护墙，撞击造成伤害',
    dmg: 10, count: 2, radius: 78, size: 16, spin: 2.4,
    maxLv: 5, up: ['+1 防护块', '+伤害', '+1 防护块', '+范围与伤害']
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
    name: '备份分身', color: '#e879f9', type: 'orbit',
    desc: '环绕旋转的备份节点',
    dmg: 7, count: 3, radius: 110, size: 10, spin: -3.2,
    maxLv: 5, up: ['+1 节点', '+伤害', '+1 节点', '+速度与伤害']
  }
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
  kernel_panic: { name: '内核恐慌', color: '#dc2626', hp: 2600, dmg: 30, speed: 40, r: 34, xp: 120, shape: 'boss', boss: true },
  data_destroyer: { name: '数据毁灭者', color: '#7c3aed', hp: 5200, dmg: 40, speed: 46, r: 40, xp: 300, shape: 'boss', boss: true }
}

// ---------- 数值表：波次（t 为秒） ----------

export const WAVES = [
  { t: 0, interval: 1.1, types: { bug: 1 } },
  { t: 40, interval: 1.0, types: { bug: 2 } },
  { t: 90, interval: 0.95, types: { bug: 2, zombie: 1 } },
  { t: 150, interval: 0.9, types: { bug: 1, zombie: 2 } },
  { t: 210, interval: 0.85, types: { zombie: 2, leak: 1 } },
  { t: 280, interval: 0.8, types: { bug: 2, leak: 2 } },
  { t: 350, interval: 0.75, types: { leak: 2, ddos: 1 } },
  { t: 430, interval: 0.7, types: { zombie: 2, ddos: 2 } },
  { t: 510, interval: 0.65, types: { ddos: 2, worm: 1 } },
  { t: 600, interval: 0.6, types: { leak: 2, worm: 2, splitter: 1 } },
  { t: 680, interval: 0.55, types: { ddos: 3, worm: 1 } },
  { t: 760, interval: 0.5, types: { worm: 2, spam: 1, splitter: 1 } },
  { t: 840, interval: 0.45, types: { ddos: 2, spam: 2 } },
  { t: 900, interval: 0.5, types: { spam: 2 }, boss: 'kernel_panic' },
  { t: 960, interval: 0.4, types: { worm: 2, spam: 2 } },
  { t: 1040, interval: 0.35, types: { ddos: 3, spam: 2, splitter: 2 } },
  { t: 1120, interval: 0.3, types: { spam: 3, worm: 2 } },
  { t: 1200, interval: 0.4, types: { spam: 2 }, boss: 'data_destroyer' }
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
    this.event = null
    this.eventT = 0
    this.nextEvent = 75
    this.statT = 0
    this.raf = 0
    this.last = 0
    this.shakeT = 0
    this.flash = 0
    this.slowmo = 0
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
  }

  reset() {
    this.state = 'playing'
    this.time = 0
    this.kills = 0
    this.enemies = []
    this.bullets = []
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
    this.pickups = []
    this.combo = 0
    this.comboT = 0
    this.dashCd = 0
    this.dashT = 0
    this.event = null
    this.eventT = 0
    this.nextEvent = 75
    this.achv = {}
    this.player = {
      x: 0, y: 0, r: 12, hp: 100, maxHp: 100,
      speed: 170, pickup: 70, cdr: 0, armor: 0, crit: 0.05, regen: 0, dmgMul: 1,
      invuln: 0, face: 0, regenAcc: 0,
      level: 1, xp: 0, xpNeed: XP_CURVE(1),
      weapons: { firewall: 1 }, passives: {},
      cds: {}, orbitA: 0
    }
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
    if (p.hp > maxHp) p.hp = maxHp
    p.maxHp = maxHp
  }

  start() {
    this.reset()
    this.last = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }

  loop = (ts) => {
    if (this.state === 'over' || this.state === 'win') return
    this.raf = requestAnimationFrame(this.loop)
    let dt = (ts - this.last) / 1000
    this.last = ts
    if (dt > 0.05) dt = 0.05
    if (dt < 0) dt = 0
    if (this.slowmo > 0) { this.slowmo -= dt; dt *= 0.3 }
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
      if (Math.random() < 0.6) this.particles.push({ x: p.x, y: p.y, vx: rand(-30, 30), vy: rand(-30, 30), t: 0.3, color: '#22d3ee', size: 3 })
    }
    // 移动
    let ix = this.input.x, iy = this.input.y
    const m = Math.hypot(ix, iy)
    if (m > 1) { ix /= m; iy /= m }
    p.x += ix * p.speed * dt
    p.y += iy * p.speed * dt
    if (m > 0.1) p.face = Math.atan2(iy, ix)
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
    this.updateGems(dt)
    this.updateFx(dt)
  }

  // ---------- 武器 ----------

  fireWeapons(dt) {
    const p = this.player
    this.orbits = []
    for (const id in p.weapons) {
      const lv = p.weapons[id]
      const w = WEAPONS[id]
      if (w.type === 'orbit') {
        p.orbitA += w.spin * dt
        const n = w.count + (lv >= 3 ? 1 : 0) + (lv >= 5 ? 1 : 0)
        const rad = w.radius + (lv >= 4 ? 24 : 0)
        const dmg = w.dmg * (1 + (lv - 1) * 0.35)
        for (let i = 0; i < n; i++) {
          const a = p.orbitA + i * TAU / n
          this.orbits.push({ x: p.x + Math.cos(a) * rad, y: p.y + Math.sin(a) * rad, size: w.size, dmg, color: w.color })
        }
      } else if (w.type === 'wave') {
        continue
      } else {
        p.cds[id] = (p.cds[id] || 0) - dt
        if (p.cds[id] <= 0) {
          const fired = this.fireWeapon(id, w, lv)
          if (fired) p.cds[id] = w.cd * (1 - p.cdr)
        }
      }
    }
  }

  fireWeapon(id, w, lv) {
    const p = this.player
    const mul = 1 + (lv - 1) * 0.3
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
        if (dist2(e.x, e.y, px, py) < (e.r + half) * (e.r + half)) this.dealDamage(e, dmg)
      }
      this.lasers.push({ x: p.x, y: p.y, ex, ey, t: 0.25, w: half * 2, color: w.color })
      return true
    }
    if (w.type === 'nova') {
      const radius = w.radius + (lv >= 2 ? 30 : 0) + (lv >= 5 ? 30 : 0)
      const dmg = w.dmg * mul
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.dead && dist2(e.x, e.y, p.x, p.y) < (radius + e.r) * (radius + e.r)) this.dealDamage(e, dmg)
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
    b.life = 3; b.dead = false
    this.bullets.push(b)
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
      this.eliteTimer = 75
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
    e.elite = false; e.child = false; e.gold = Math.random() < 0.03
    e.x = this.player.x + Math.cos(a) * R
    e.y = this.player.y + Math.sin(a) * R
    const mul = 1 + (this.time / 60) * 0.35
    e.maxHp = d.hp * mul
    e.hp = e.maxHp
    e.dmg = d.dmg * (1 + (this.time / 60) * 0.12)
    e.speed = d.speed; e.r = d.r; e.xp = d.xp
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
    e.x = x; e.y = y
    const mul = 1 + (this.time / 60) * 0.35
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
    e.x = this.player.x + Math.cos(a) * R
    e.y = this.player.y + Math.sin(a) * R
    const mul = 1 + (this.time / 60) * 0.35
    e.maxHp = d.hp * mul * 10
    e.hp = e.maxHp
    e.dmg = d.dmg * 1.5
    e.speed = d.speed * 0.85; e.r = d.r * 1.5; e.xp = d.xp * 8
    e.shape = d.shape; e.color = '#fde047'; e.boss = false
    this.enemies.push(e)
    this.floats.push({ x: this.player.x, y: this.player.y - 40, txt: '精英故障出现，击杀掉落宝箱', t: 1.6, color: '#fde047', big: true })
  }

  spawnBoss(type) {
    this.spawnEnemy(type)
    const d = ENEMIES[type]
    sound.play('boss')
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
      const dx = p.x - e.x, dy = p.y - e.y
      const d = Math.hypot(dx, dy) || 1
      const spd = e.speed * (this.event === 'slow' ? 0.45 : 1)
      e.x += dx / d * spd * dt
      e.y += dy / d * spd * dt
      if (d < e.r + p.r) this.hurtPlayer(e.dmg)
      if (e.orbitCd > 0) {
        e.orbitCd -= dt
      } else {
        for (let j = 0; j < this.orbits.length; j++) {
          const o = this.orbits[j]
          const rr = e.r + o.size * 0.6
          if (dist2(e.x, e.y, o.x, o.y) < rr * rr) {
            this.dealDamage(e, o.dmg)
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
      const near = this.hash.query(b.x, b.y, 40)
      for (let j = 0; j < near.length; j++) {
        const e = near[j]
        if (e.dead) continue
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
          this.dealDamage(e, b.dmg)
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
    let d = base * p.dmgMul
    const crit = Math.random() < p.crit
    if (crit) d *= 2
    e.hp -= d
    sound.play('hit')
    this.floats.push({ x: e.x + rand(-6, 6), y: e.y - e.r, txt: String(d | 0), t: 0.7, color: crit ? '#fde047' : '#e2e8f0' })
    if (e.hp <= 0) this.killEnemy(e)
  }

  killEnemy(e) {
    if (e.dead) return
    e.dead = true
    this.kills++
    this.combo++
    this.comboT = 3
    this.burst(e.x, e.y, e.color, e.boss ? 24 : 6)
    if (e.boss) {
      this.slowmo = 0.5
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
    const d = Math.max(1, dmg * (1 - p.armor))
    p.hp -= d
    p.invuln = 0.6
    this.shakeT = this.time + 0.3
    this.flash = 0.5
    sound.play('hurt')
    this.floats.push({ x: p.x, y: p.y - 16, txt: '-' + String(d | 0), t: 0.7, color: '#f87171' })
    if (p.hp <= 0) {
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
    sound.play('shoot')
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
    for (let i = 0; i < newAchv.length; i++) {
      this.floats.push({ x: p.x, y: p.y - 70 - i * 22, txt: '🏆 ' + newAchv[i], t: 3, color: '#fde047', big: true })
      sound.play('levelup')
    }
    this.cb.onStats({
      hp: p.hp, maxHp: p.maxHp, level: p.level, xp: p.xp, xpNeed: p.xpNeed,
      time: this.time, kills: this.kills, state: this.state, combo: this.combo, dashCd: Math.max(0, this.dashCd), event: this.event, eventT: Math.max(0, this.eventT),
      weapons: Object.assign({}, p.weapons), passives: Object.assign({}, p.passives)
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

    ctx.save()
    ctx.translate(-camX, -camY)

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
      ctx.rotate(this.time * (e.boss ? 0.5 : 1.5))
      ctx.shadowColor = e.color
      ctx.shadowBlur = e.boss ? 24 : (e.elite ? 16 : 8)
      ctx.strokeStyle = e.color
      ctx.lineWidth = 2
      drawShape(ctx, e.shape, e.r)
      ctx.stroke()
      ctx.fillStyle = e.color + '33'
      ctx.fill()
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

    // 环绕武器
    for (let i = 0; i < this.orbits.length; i++) {
      const o = this.orbits[i]
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

    // 玩家
    ctx.save()
    ctx.translate(p.x, p.y)
    if (p.invuln > 0 && ((this.time * 20) | 0) % 2 === 0) ctx.globalAlpha = 0.4
    ctx.shadowColor = '#22d3ee'
    ctx.shadowBlur = 16
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath()
    ctx.arc(0, 0, p.r, 0, TAU)
    ctx.fill()
    ctx.rotate(p.face)
    ctx.fillStyle = '#e0f2fe'
    ctx.beginPath()
    ctx.moveTo(p.r + 7, 0)
    ctx.lineTo(p.r - 2, -5)
    ctx.lineTo(p.r - 2, 5)
    ctx.closePath()
    ctx.fill()
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
      ctx.font = (f.big ? 'bold 20px' : '12px') + ' monospace'
      ctx.fillText(f.txt, f.x, f.y)
      ctx.globalAlpha = 1
    }

    ctx.restore()

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
    // 受击红闪
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(239,68,68,' + (Math.min(0.5, this.flash) * 0.6).toFixed(3) + ')'
      ctx.fillRect(0, 0, this.W, this.H)
    }
  }
}
