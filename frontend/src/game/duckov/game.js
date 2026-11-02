/* ============================================================
 * 逃离鹅科夫：运维封锁区 · 核心游戏引擎
 * 职责：状态持有与更新循环；地图/敌人/迷雾由独立模块提供
 * 渲染完全在 renderer.js，本文件不依赖 DOM
 * ============================================================ */
import { generateMap, roomAt, ROOM_TYPES } from './mapgen.js'
import { createEnemy, updateEnemy, makeNoise } from './entities.js'
import { computeFov, updateExplored } from './fog.js'
import { sound } from '../audio.js'

const TAU = Math.PI * 2
const rand = (a, b) => a + Math.random() * (b - a)

// 武器定义：手感差异化
export const WEAPONS = {
  pistol: { name: '运维手枪', dmg: 24, cd: 0.32, speed: 520, spread: 0.04, mag: 8, reload: 1.0, noise: 180, color: '#67e8f9' },
  smg: { name: '散热冲锋枪', dmg: 13, cd: 0.11, speed: 560, spread: 0.12, mag: 30, reload: 1.4, noise: 260, color: '#fbbf24' },
  shotgun: { name: '脉冲霰弹', dmg: 12, pellets: 6, cd: 0.85, speed: 460, spread: 0.34, mag: 6, reload: 1.8, noise: 340, color: '#f472b6' },
  railgun: { name: '轨道炮', dmg: 90, cd: 1.1, speed: 760, spread: 0, mag: 5, reload: 2.0, noise: 420, color: '#c084fc' },
  laser: { name: '相位激光枪', dmg: 22, cd: 0.16, speed: 680, spread: 0.02, mag: 24, reload: 1.5, noise: 280, color: '#a3e635' },
  rocket: { name: '火箭发射器', dmg: 80, cd: 1.4, speed: 380, spread: 0.03, mag: 3, reload: 2.4, noise: 400, color: '#fb923c', aoe: 70 }
}

// 配件定义：8 大部件 × 4 档（低端/中端/高端/至尊），价值按真实行情缩放（¥100≈10 金币）
// CPU 与主板分 AMD/Intel 平台，合成整机时平台必须一致
export const PART_CATS = {
  cpu: '处理器', mb: '主板', gpu: '显卡', ram: '内存',
  ssd: '固态硬盘', psu: '电源', case: '机箱', cooler: '散热器'
}
export const TIER_NAMES = ['低端', '中端', '高端', '至尊']

export const PARTS = [
  // 处理器（AMD / Intel）
  { id: 'cpu-a0', name: '锐龙5 5600GT', cat: 'cpu', tier: 0, platform: 'amd', value: 105, size: 1, color: '#fb923c' },
  { id: 'cpu-i0', name: '酷睿 i5-12490F', cat: 'cpu', tier: 0, platform: 'intel', value: 128, size: 1, color: '#60a5fa' },
  { id: 'cpu-a1', name: '锐龙5 9600X', cat: 'cpu', tier: 1, platform: 'amd', value: 150, size: 1, color: '#fb923c' },
  { id: 'cpu-i1', name: '酷睿 i5-14600KF', cat: 'cpu', tier: 1, platform: 'intel', value: 250, size: 1, color: '#60a5fa' },
  { id: 'cpu-a2', name: '锐龙7 9800X3D', cat: 'cpu', tier: 2, platform: 'amd', value: 380, size: 1, color: '#fb923c' },
  { id: 'cpu-i2', name: '酷睿 i9-14900K', cat: 'cpu', tier: 2, platform: 'intel', value: 500, size: 1, color: '#60a5fa' },
  { id: 'cpu-a3', name: '锐龙9 9950X3D', cat: 'cpu', tier: 3, platform: 'amd', value: 600, size: 1, color: '#f97316' },
  { id: 'cpu-i3', name: '酷睿 Ultra 9 285K', cat: 'cpu', tier: 3, platform: 'intel', value: 480, size: 1, color: '#93c5fd' },
  // 主板（AMD / Intel）
  { id: 'mb-a0', name: '微星 A520M', cat: 'mb', tier: 0, platform: 'amd', value: 50, size: 2, color: '#fb923c' },
  { id: 'mb-i0', name: '华硕 H610M-K', cat: 'mb', tier: 0, platform: 'intel', value: 78, size: 2, color: '#60a5fa' },
  { id: 'mb-a1', name: '技嘉 B650M', cat: 'mb', tier: 1, platform: 'amd', value: 75, size: 2, color: '#fb923c' },
  { id: 'mb-i1', name: '华硕 TUF B760M', cat: 'mb', tier: 1, platform: 'intel', value: 125, size: 2, color: '#60a5fa' },
  { id: 'mb-a2', name: '七彩虹 X870E', cat: 'mb', tier: 2, platform: 'amd', value: 400, size: 2, color: '#fb923c' },
  { id: 'mb-i2', name: 'ROG STRIX Z890-A', cat: 'mb', tier: 2, platform: 'intel', value: 360, size: 2, color: '#60a5fa' },
  { id: 'mb-a3', name: 'ROG X870E Godlike', cat: 'mb', tier: 3, platform: 'amd', value: 800, size: 2, color: '#f97316' },
  { id: 'mb-i3', name: 'ROG MAXIMUS Z890', cat: 'mb', tier: 3, platform: 'intel', value: 700, size: 2, color: '#93c5fd' },
  // 显卡（NVIDIA / AMD）
  { id: 'gpu-r7600', name: 'Radeon RX 7600 8G', cat: 'gpu', tier: 0, platform: null, value: 180, size: 3, color: '#4ade80' },
  { id: 'gpu-4060', name: 'RTX 4060 8G', cat: 'gpu', tier: 0, platform: null, value: 250, size: 3, color: '#4ade80' },
  { id: 'gpu-5060ti', name: 'RTX 5060 Ti 16G', cat: 'gpu', tier: 1, platform: null, value: 410, size: 3, color: '#4ade80' },
  { id: 'gpu-9070xt', name: 'Radeon RX 9070 XT 16G', cat: 'gpu', tier: 1, platform: null, value: 540, size: 3, color: '#4ade80' },
  { id: 'gpu-5070ti', name: 'RTX 5070 Ti 16G', cat: 'gpu', tier: 2, platform: null, value: 850, size: 3, color: '#22d3ee' },
  { id: 'gpu-5080', name: 'RTX 5080 16G', cat: 'gpu', tier: 2, platform: null, value: 1600, size: 3, color: '#22d3ee' },
  { id: 'gpu-5090', name: 'RTX 5090 32G', cat: 'gpu', tier: 3, platform: null, value: 2440, size: 4, color: '#fde047' },
  // 内存
  { id: 'ram-0', name: '金百达 16G DDR4 3200', cat: 'ram', tier: 0, platform: null, value: 36, size: 1, color: '#22d3ee' },
  { id: 'ram-1', name: '芝奇 32G DDR5 6000', cat: 'ram', tier: 1, platform: null, value: 90, size: 1, color: '#22d3ee' },
  { id: 'ram-2', name: '金士顿 64G DDR5 6000', cat: 'ram', tier: 2, platform: null, value: 150, size: 1, color: '#22d3ee' },
  { id: 'ram-3', name: '芝奇 64G DDR5 7200', cat: 'ram', tier: 3, platform: null, value: 250, size: 1, color: '#fde047' },
  // 固态硬盘
  { id: 'ssd-0', name: '致态 TiPlus5000 1TB', cat: 'ssd', tier: 0, platform: null, value: 45, size: 1, color: '#94a3b8' },
  { id: 'ssd-1', name: '三星 990 EVO 1TB', cat: 'ssd', tier: 1, platform: null, value: 60, size: 1, color: '#94a3b8' },
  { id: 'ssd-2', name: '三星 990 Pro 2TB', cat: 'ssd', tier: 2, platform: null, value: 130, size: 1, color: '#94a3b8' },
  { id: 'ssd-3', name: '致态 TiPro9000 2TB', cat: 'ssd', tier: 3, platform: null, value: 150, size: 1, color: '#fde047' },
  // 电源
  { id: 'psu-0', name: '长城 HOPE-6000DS', cat: 'psu', tier: 0, platform: null, value: 26, size: 2, color: '#fb923c' },
  { id: 'psu-1', name: '振华 LEADEX 750W 金牌', cat: 'psu', tier: 1, platform: null, value: 70, size: 2, color: '#fb923c' },
  { id: 'psu-2', name: '海韵 FOCUS GX-850', cat: 'psu', tier: 2, platform: null, value: 108, size: 2, color: '#fb923c' },
  { id: 'psu-3', name: '海盗船 AX1600i 钛金', cat: 'psu', tier: 3, platform: null, value: 345, size: 2, color: '#fde047' },
  // 机箱
  { id: 'case-0', name: '先马 光之神', cat: 'case', tier: 0, platform: null, value: 12, size: 3, color: '#a78bfa' },
  { id: 'case-1', name: '爱国者 星璨岚', cat: 'case', tier: 1, platform: null, value: 36, size: 3, color: '#a78bfa' },
  { id: 'case-2', name: '华硕 TUF GT502', cat: 'case', tier: 2, platform: null, value: 105, size: 3, color: '#a78bfa' },
  { id: 'case-3', name: '联力 包豪斯 O11D', cat: 'case', tier: 3, platform: null, value: 150, size: 3, color: '#fde047' },
  // 散热器
  { id: 'cool-0', name: '利民 AX120 R SE', cat: 'cooler', tier: 0, platform: null, value: 6, size: 1, color: '#67e8f9' },
  { id: 'cool-1', name: '利民 PA120 SE', cat: 'cooler', tier: 1, platform: null, value: 15, size: 1, color: '#67e8f9' },
  { id: 'cool-2', name: '猫头鹰 NH-D15', cat: 'cooler', tier: 2, platform: null, value: 70, size: 1, color: '#67e8f9' },
  { id: 'cool-3', name: 'ROG 龙神 III 360 水冷', cat: 'cooler', tier: 3, platform: null, value: 250, size: 2, color: '#fde047' }
]

export class DuckovGame {
  constructor(canvas, cb) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.cb = cb || {}
    this.state = 'ready'
    this.time = 0
    this.raf = null
    this.lastTs = 0
    this.keys = {}
    this.mouse = { x: 0, y: 0, down: false }
    this.onEnd = cb.onEnd || (() => {})
    this.onHud = cb.onHud || (() => {})
  }

  start(cfg = {}) {
    this.map = generateMap({})
    this.enemies = this.map.spawns.map(s => createEnemy(s, this.map))
    // 上一局遗体：死亡时记录的携带物资在出生点附近生成尸体（可长按 E 搜回）
    try {
      const corpse = JSON.parse(localStorage.getItem('duckov_corpse') || 'null')
      if (corpse && corpse.bag && corpse.bag.length) {
        const offs = [[46, 0], [0, 46], [-46, 0], [0, -46], [72, 0], [0, 72], [-72, 0], [0, -72]]
        for (const [dx, dy] of offs) {
          const x = this.map.playerSpawn.x + dx
          const y = this.map.playerSpawn.y + dy
          if (!this.pointInWall(x, y)) {
            this.map.lootSpots.push({ x, y, room: -1, tier: 0, opened: false, corpse: true, bag: corpse.bag, value: corpse.value || 0 })
            break
          }
        }
      }
    } catch (e) { /* localStorage 不可用时忽略 */ }
    this.bullets = []
    this.ebullets = []
    this.particles = []
    this.floats = []
    this.noiseRings = []
    this.time = 0
    this.exitT = 150
    this.exitProgress = 0
    this.exitTarget = null
    this.openT = 0
    this.openTarget = null
    this.shakeT = 0
    this.flash = 0
    this.flashGold = 0
    this.blackout = 0
    this.blackoutT = rand(50, 80)
    this.alert = 0
    this.kills = 0
    this.lootValue = 0
    this.hasKey = false
    this.armorMul = cfg.armorMul || 1
    this.armorName = cfg.armorName || ''
    this.armorId = cfg.armorId || ''
    this.safebox = cfg.safebox || []
    this.safeboxCap = cfg.safeboxCap || 4
    this.medkits = cfg.medkits || 0
    this.stims = cfg.stims || 0
    this.emps = cfg.emps || 0
    this.player = {
      x: this.map.playerSpawn.x, y: this.map.playerSpawn.y, r: 12,
      hp: 100, maxHp: 100,
      speed: 175, face: 0,
      weapon: 'pistol', ammo: {}, reloadT: 0, fireT: 0,
      stamina: 100, dashT: 0, dashCd: 0, stimT: 0,
      bag: [], bagSize: cfg.bagSize || 10,
      invuln: 0, dead: false
    }
    this.ownedWeapons = cfg.weapons || ['pistol']
    for (const id of this.ownedWeapons) {
      if (WEAPONS[id] && WEAPONS[id].mag !== Infinity) this.player.ammo[id] = WEAPONS[id].mag
    }
    this.state = 'playing'
    this.paused = false
    this.lastTs = performance.now()
    this.loop()
  }

  togglePause() {
    if (this.state !== 'playing') return
    this.paused = !this.paused
  }

  loop() {
    this.raf = requestAnimationFrame(() => this.loop())
    const now = performance.now()
    let dt = (now - this.lastTs) / 1000
    this.lastTs = now
    if (dt > 0.05) dt = 0.05
    // 击杀 hitstop：减速期间用真实 dt 递减计时，游戏世界 dt 缩放至 15%
    if (this.hitstopT > 0) this.hitstopT -= dt
    if (this.state === 'playing' && !this.paused) {
      try {
        this.update(this.hitstopT > 0 ? dt * 0.15 : dt)
      } catch (err) {
        console.error('[duckov]', err)
        this.endRun(false, '内部错误：' + (err && err.message ? err.message : '未知') + '（本局终止，不影响下一局）')
      }
    }
    this.render()
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = null
  }

  lineClear(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1
    const d = Math.hypot(dx, dy) || 1
    for (const w of this.map.walls) {
      const t = segAabb(x1, y1, dx / d, dy / d, w, d)
      if (t !== null) return false
    }
    return true
  }

  collideWalls(x, y, r) {
    for (const w of this.map.walls) {
      if (x + r < w.x || x - r > w.x + w.w || y + r < w.y || y - r > w.y + w.h) continue
      const nx = Math.max(w.x, Math.min(x, w.x + w.w))
      const ny = Math.max(w.y, Math.min(y, w.y + w.h))
      const dx = x - nx, dy = y - ny
      const dd = Math.hypot(dx, dy)
      if (dd < r) {
        if (dd > 0.001) {
          x = nx + dx / dd * r
          y = ny + dy / dd * r
        } else {
          const l = x - w.x, rt = w.x + w.w - x, tp = y - w.y, bt = w.y + w.h - y
          const mn = Math.min(l, rt, tp, bt)
          if (mn === l) x = w.x - r
          else if (mn === rt) x = w.x + w.w + r
          else if (mn === tp) y = w.y - r
          else y = w.y + w.h + r
        }
      }
    }
    for (const pr of this.map.props) {
      if (pr.hp <= 0) continue
      if (x + r < pr.x || x - r > pr.x + pr.w || y + r < pr.y || y - r > pr.y + pr.h) continue
      const nx = Math.max(pr.x, Math.min(x, pr.x + pr.w))
      const ny = Math.max(pr.y, Math.min(y, pr.y + pr.h))
      const dx = x - nx, dy = y - ny
      const dd = Math.hypot(dx, dy)
      if (dd < r && dd > 0.001) {
        x = nx + dx / dd * r
        y = ny + dy / dd * r
      }
    }
    return { x, y }
  }

  roomName(r) {
    return (ROOM_TYPES[r.type] || {}).name || '走廊'
  }

  onSpotted() {
    sound.play('hurt')
    this.alert = Math.min(3, this.alert + 0.5)
  }

  enemyShoot(e, aim) {
    const k = e.d
    this.ebullets.push({ x: e.x + Math.cos(aim) * (e.r + 4), y: e.y + Math.sin(aim) * (e.r + 4), vx: Math.cos(aim) * k.bullet, vy: Math.sin(aim) * k.bullet, r: 4, dmg: k.dmg, life: 2.2, color: k.color })
    makeNoise(this, e.x, e.y, 120)
  }

  update(dt) {
    const p = this.player
    this.time += dt
    this.exitT -= dt
    if (this.flash > 0) this.flash -= dt
    if (this.flashGold > 0) this.flashGold -= dt
    if (p.invuln > 0) p.invuln -= dt

    this.blackoutT -= dt
    if (this.blackoutT <= 0 && this.blackout <= 0) {
      this.blackout = 10
      this.blackoutT = rand(60, 90)
      this.floats.push({ x: p.x, y: p.y - 50, txt: '突发断电！视野受限，敌人同样失明', t: 2.5, color: '#f87171', big: true })
      sound.play('boss')
    }
    if (this.blackout > 0) this.blackout -= dt

    if (this.exitT <= 0) {
      this.endRun(false, '断电时刻已到，封锁区永久关闭')
      return
    }

    let ix = 0, iy = 0
    if (this.keys['w'] || this.keys['arrowup']) iy -= 1
    if (this.keys['s'] || this.keys['arrowdown']) iy += 1
    if (this.keys['a'] || this.keys['arrowleft']) ix -= 1
    if (this.keys['d'] || this.keys['arrowright']) ix += 1
    const load = p.bag.reduce((s, l) => s + l.size, 0)
    const loadMul = 1 - Math.min(0.3, load / p.bagSize * 0.3)
    const room = roomAt(this.map, p.x, p.y)
    const coolMul = room && room.type === 'cooling' ? 0.7 : 1
    // 辐射室：持续掉血，高价值物资的风险代价
    if (room && room.type === 'radiation') {
      p.hp -= 2.5 * dt
      this.radWarnT = (this.radWarnT || 0) - dt
      if (this.radWarnT <= 0) {
        this.radWarnT = 1.5
        this.floats.push({ x: p.x, y: p.y - 30, txt: '辐射伤害中！尽快离开', t: 1, color: '#fb923c' })
      }
      if (p.hp <= 0 && !p.dead) {
        p.dead = true
        this.endRun(false, '倒在辐射室——装备与物资掉落在封锁区')
        return
      }
    }
    let spd = p.speed * loadMul * coolMul
    if (p.stimT > 0) {
      p.stimT -= dt
      spd *= 1.35
      if (Math.random() < 0.3) this.particles.push({ x: p.x, y: p.y, vx: rand(-15, 15), vy: rand(-15, 15), t: 0.2, color: '#a3e635', size: 2 })
    }
    if (p.dashT > 0) {
      p.dashT -= dt
      spd *= 2.6
      if (Math.random() < 0.6) this.particles.push({ x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), t: 0.25, color: '#67e8f9', size: 3 })
    }
    if (p.dashCd > 0) p.dashCd -= dt
    if (p.stamina < 100) p.stamina = Math.min(100, p.stamina + 18 * dt)
    if (ix || iy) {
      const m = Math.hypot(ix, iy)
      const c = this.collideWalls(p.x + ix / m * spd * dt, p.y + iy / m * spd * dt, p.r)
      p.x = c.x
      p.y = c.y
    }
    p.face = Math.atan2(this.mouse.y - this.canvas.height / 2, this.mouse.x - this.canvas.width / 2)

    const w = WEAPONS[p.weapon]
    // 切枪打断装填
    if (p.lastWeapon !== p.weapon) { p.lastWeapon = p.weapon; p.reloadT = 0 }
    // R 键手动换弹（弹匣未满时）
    if (this.keys['r'] && p.reloadT <= 0 && w.mag !== Infinity && p.ammo[p.weapon] < w.mag) {
      p.reloadT = w.reload
      this.floats.push({ x: p.x, y: p.y - 30, txt: '装填中...', t: 0.8, color: '#fbbf24' })
    }
    if (p.reloadT > 0) {
      p.reloadT -= dt
      if (p.reloadT <= 0) {
        p.ammo[p.weapon] = w.mag
        this.floats.push({ x: p.x, y: p.y - 30, txt: '装填完毕', t: 0.8, color: '#4ade80' })
      }
    }
    if (p.fireT > 0) p.fireT -= dt
    if (this.mouse.down && p.fireT <= 0 && p.reloadT <= 0) {
      if (w.mag !== Infinity && p.ammo[p.weapon] <= 0) {
        p.reloadT = w.reload
        this.floats.push({ x: p.x, y: p.y - 30, txt: '装填中...', t: 0.8, color: '#fbbf24' })
      } else {
        p.fireT = w.cd
        if (w.mag !== Infinity) p.ammo[p.weapon]--
        const n = w.pellets || 1
        for (let i = 0; i < n; i++) {
          const a = p.face + rand(-w.spread, w.spread)
          this.bullets.push({ x: p.x + Math.cos(p.face) * 16, y: p.y + Math.sin(p.face) * 16, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, r: 3, dmg: w.dmg, life: 1.2, color: w.color, aoe: w.aoe || 0 })
        }
        sound.play('shoot_' + p.weapon)
        makeNoise(this, p.x, p.y, w.noise)
        this.shakeT = 0.08
      }
    }

    this.updateInteract(dt)

    for (const e of this.enemies) {
      if (e.dead) continue
      const oldSight = e.d.sight
      if (this.blackout > 0) e.d.sight = 90
      updateEnemy(this, e, dt)
      e.d.sight = oldSight
    }
    if (this.alert > 0) this.alert = Math.max(0, this.alert - dt * 0.05)

    for (const b of this.bullets) {
      b.life -= dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.life <= 0) {
        b.dead = true
        continue
      }
      if (this.pointInWall(b.x, b.y)) {
        if (b.aoe) this.explode(b.x, b.y, b.aoe, b.dmg)
        else for (let i = 0; i < 3; i++) this.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), t: 0.15, color: b.color, size: 2 })
        b.dead = true
        continue
      }
      for (const pr of this.map.props) {
        if (pr.hp <= 0) continue
        if (b.x > pr.x && b.x < pr.x + pr.w && b.y > pr.y && b.y < pr.y + pr.h) {
          if (b.aoe) this.explode(b.x, b.y, b.aoe, b.dmg)
          pr.hp -= b.dmg
          for (let i = 0; i < 4; i++) this.particles.push({ x: b.x, y: b.y, vx: rand(-50, 50), vy: rand(-50, 50), t: 0.2, color: '#a16207', size: 2 })
          if (pr.hp <= 0) this.floats.push({ x: pr.x + pr.w / 2, y: pr.y, txt: '货架被击碎！', t: 1, color: '#a16207' })
          b.dead = true
          break
        }
      }
      if (b.dead) continue
      for (const e of this.enemies) {
        if (e.dead) continue
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r) {
          if (b.aoe) {
            this.explode(b.x, b.y, b.aoe, b.dmg)
            b.dead = true
            break
          }
          e.hp -= b.dmg
          e.flashT = 0.08
          sound.hitPitch(e.hp / e.maxHp)
          this.floats.push({ x: e.x + rand(-6, 6), y: e.y - e.r, txt: String(b.dmg), t: 0.6, color: '#fde047' })
          for (let i = 0; i < 4; i++) this.particles.push({ x: b.x, y: b.y, vx: rand(-60, 60), vy: rand(-60, 60), t: 0.25, color: e.d.color, size: 2.5 })
          if (e.state !== 'combat') {
            e.state = 'combat'
            e.stateT = 0
            e.alertMark = '!'
            e.alertMarkT = 1.2
          }
          e.lastSeen = { x: p.x, y: p.y }
          if (e.hp <= 0) this.killEnemy(e)
          b.dead = true
          break
        }
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead && b.life > 0)

    for (const b of this.ebullets) {
      b.life -= dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.life <= 0 || this.pointInWall(b.x, b.y)) {
        b.dead = true
        continue
      }
      // 掩体也阻挡敌方子弹
      for (const pr of this.map.props) {
        if (pr.hp <= 0) continue
        if (b.x > pr.x && b.x < pr.x + pr.w && b.y > pr.y && b.y < pr.y + pr.h) {
          b.dead = true
          for (let i = 0; i < 3; i++) this.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), t: 0.15, color: b.color, size: 2 })
          break
        }
      }
      if (!p.dead) {
        // 扫掠碰撞（线段-圆）：防止低帧率下高速子弹隧穿玩家导致不扣血
        const bx0 = b.x - b.vx * dt, by0 = b.y - b.vy * dt
        const sx = b.x - bx0, sy = b.y - by0
        const tt = Math.max(0, Math.min(1, ((p.x - bx0) * sx + (p.y - by0) * sy) / (sx * sx + sy * sy || 1)))
        const cx = bx0 + sx * tt, cy = by0 + sy * tt
        if (Math.hypot(cx - p.x, cy - p.y) < p.r + b.r) {
          this.lastHitAng = Math.atan2(b.vy, b.vx)
          this.hurtPlayer(b.dmg)
          b.dead = true
        }
      }
    }
    this.ebullets = this.ebullets.filter(b => !b.dead)

    for (const pt of this.particles) {
      pt.t -= dt
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
    }
    this.particles = this.particles.filter(pt => pt.t > 0)
    for (const f of this.floats) {
      f.t -= dt
      f.y -= 26 * dt
    }
    this.floats = this.floats.filter(f => f.t > 0)
    for (const n of this.noiseRings) {
      n.t -= dt
      n.r = n.max * (1 - n.t / 0.6)
    }
    this.noiseRings = this.noiseRings.filter(n => n.t > 0)
    if (this.shakeT > 0) this.shakeT -= dt

    // 敌人脚步声：最近敌人距离衰减 + 立体声定位（越近节奏越快）
    this.footT = (this.footT || 0) - dt
    if (this.footT <= 0) {
      let best = null, bd = 320
      for (const en of this.enemies) {
        if (en.dead) continue
        const d = Math.hypot(en.x - p.x, en.y - p.y)
        if (d < bd) { bd = d; best = en }
      }
      if (best) {
        this.footT = 0.18 + bd / 320 * 0.3
        const ang = Math.atan2(best.y - p.y, best.x - p.x)
        const vol = 0.04 * (1 - bd / 320)
        if (vol > 0.005) sound.beepPan(90, 0.045, 'triangle', vol, 60, Math.sin(ang - p.face))
      } else {
        this.footT = 0.35
      }
    }
    // 低血量心跳（HP<30 循环，节流 900ms）
    if (p.hp < 30 && !p.dead) sound.play('heartbeat')
    // 受击方向指示计时
    if (this.hitDirT > 0) this.hitDirT -= dt

    this.fovPoly = computeFov(this, p.x, p.y, this.blackout > 0 ? 150 : 360)
    updateExplored(this)

    this.onHud(this.hudData())
  }

  pointInWall(x, y) {
    for (const w of this.map.walls) {
      if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) return true
    }
    return false
  }

  explode(x, y, radius, dmg) {
    this.shakeT = 0.2
    for (let i = 0; i < 16; i++) this.particles.push({ x, y, vx: rand(-140, 140), vy: rand(-140, 140), t: 0.5, color: '#fb923c', size: 3.5 })
    this.floats.push({ x, y: y - 20, txt: '轰！', t: 0.8, color: '#fb923c', big: true })
    makeNoise(this, x, y, 320)
    for (const e of this.enemies) {
      if (e.dead) continue
      const d = Math.hypot(e.x - x, e.y - y)
      if (d < radius + e.r) {
        const real = Math.max(5, Math.round(dmg * (1 - 0.5 * d / (radius + e.r))))
        e.hp -= real
        e.flashT = 0.08
        sound.hitPitch(e.hp / e.maxHp)
        this.floats.push({ x: e.x + rand(-6, 6), y: e.y - e.r, txt: String(real), t: 0.6, color: '#fde047' })
        if (e.state !== 'combat') {
          e.state = 'combat'
          e.stateT = 0
          e.alertMark = '!'
          e.alertMarkT = 1.2
        }
        e.lastSeen = { x: this.player.x, y: this.player.y }
        if (e.hp <= 0) this.killEnemy(e)
      }
    }
  }

  bomberExplode(e) {
    e.hp = 0
    this.killEnemy(e)
    this.shakeT = 0.25
    this.floats.push({ x: e.x, y: e.y - 20, txt: '自爆！', t: 1, color: '#f97316', big: true })
    for (let i = 0; i < 20; i++) this.particles.push({ x: e.x, y: e.y, vx: rand(-160, 160), vy: rand(-160, 160), t: 0.5, color: '#f97316', size: 3.5 })
    makeNoise(this, e.x, e.y, 300)
    const p = this.player
    const d = Math.hypot(p.x - e.x, p.y - e.y)
    if (d < 90) {
      this.lastHitAng = Math.atan2(p.y - e.y, p.x - e.x)
      this.hurtPlayer(Math.max(10, Math.round(e.d.dmg * (1 - 0.5 * d / 90))))
    }
  }

  updateInteract(dt) {
    const p = this.player
    // 急救站：路过自动拾取回血（满血时不消耗）
    for (const h of (this.map.healSpots || [])) {
      if (h.taken) continue
      if (Math.hypot(h.x - p.x, h.y - p.y) < 26 && p.hp < p.maxHp) {
        h.taken = true
        p.hp = Math.min(p.maxHp, p.hp + 30)
        this.floats.push({ x: p.x, y: p.y - 40, txt: '急救站 +30 HP', t: 1.2, color: '#4ade80', big: true })
        sound.play('levelup')
        for (let i = 0; i < 6; i++) this.particles.push({ x: h.x, y: h.y, vx: rand(-30, 30), vy: rand(-50, -10), t: 0.5, color: '#4ade80', size: 2.5 })
      }
    }
    let near = null
    for (const s of this.map.lootSpots) {
      if (s.opened) continue
      if (Math.hypot(s.x - p.x, s.y - p.y) < 42) {
        near = s
        break
      }
    }
    this.openTarget = near
    if (near && this.keys['e']) {
      this.openT += dt
      if (this.openT >= 1.2) {
        this.openT = 0
        if (near.corpse) {
          // 上一局遗体：搜回死亡时携带的物资（背包满则保留剩余，不消耗尸体）
          let load = p.bag.reduce((s2, l2) => s2 + l2.size, 0)
          let got = 0
          let gotVal = 0
          for (const it of near.bag) {
            if (load + it.size > p.bagSize) break
            p.bag.push(it)
            this.lootValue += it.value
            load += it.size
            got++
            gotVal += it.value
          }
          if (got > 0) {
            this.floats.push({ x: p.x, y: p.y - 40, txt: '搜回遗体物资 x' + got + '（价值 ' + gotVal + '）', t: 1.6, color: '#4ade80', big: true })
            sound.play('pickup2')
            for (let i = 0; i < 10; i++) this.particles.push({ x: near.x, y: near.y, vx: rand(-60, 60), vy: rand(-80, -10), t: 0.6, color: '#a3a3a3', size: 2.5 })
          }
          if (got >= near.bag.length) {
            near.opened = true
            try { localStorage.removeItem('duckov_corpse') } catch (e2) { /* 忽略 */ }
          } else {
            this.floats.push({ x: p.x, y: p.y - 62, txt: '背包空间不足，仅搜回部分物资', t: 1.4, color: '#f87171', big: true })
          }
          makeNoise(this, p.x, p.y, 150)
        } else {
        // 按物资点档位加权掉落配件；至尊件（tier 3）仅 Boss 掉落，普通物资点不出
        const pool = PARTS.filter(pt => pt.tier <= near.tier && pt.tier >= near.tier - 1 && pt.tier < 3)
        const l = pool[(Math.random() * pool.length) | 0]
        const load = p.bag.reduce((s2, l2) => s2 + l2.size, 0)
        if (load + l.size > p.bagSize) {
          // 背包满：不消耗搜刮点，物资保留原地
          this.floats.push({ x: p.x, y: p.y - 40, txt: '背包已满！先丢弃低价值物品', t: 1.2, color: '#f87171', big: true })
        } else {
          near.opened = true
          p.bag.push({ id: l.id, name: l.name, value: l.value, size: l.size, color: l.color, cat: l.cat, tier: l.tier, platform: l.platform || null })
          this.lootValue += l.value
          this.floats.push({ x: p.x, y: p.y - 40, txt: '获得 ' + l.name + '（价值 ' + l.value + '）', t: 1.2, color: l.color, big: true })
          // 档位差异化拾取音：高端/至尊件触发全屏金光特效
          sound.play('pickup' + l.tier)
          if (l.tier >= 2) {
            this.flashGold = l.tier === 3 ? 1.0 : 0.6
            for (let i = 0; i < (l.tier === 3 ? 26 : 14); i++) {
              this.particles.push({ x: p.x, y: p.y, vx: rand(-120, 120), vy: rand(-160, -30), t: rand(0.5, 0.9), color: l.tier === 3 ? '#fde047' : '#fbbf24', size: rand(2, 4) })
            }
            if (l.tier === 3) this.floats.push({ x: p.x, y: p.y - 62, txt: '✦ 至尊配件！✦', t: 1.8, color: '#fde047', big: true })
          }
          makeNoise(this, p.x, p.y, 150)
        }
        }
      }
    } else {
      this.openT = 0
    }
    let ex = null
    let lockedNear = null
    for (const e of this.map.exits) {
      if (Math.hypot(e.x - p.x, e.y - p.y) < 46) {
        if (e.needKey && !this.hasKey) { lockedNear = e; continue }
        ex = e
        break
      }
    }
    this.exitTarget = ex
    if (lockedNear && !ex) {
      this.lockedHintT = (this.lockedHintT || 0) - dt
      if (this.lockedHintT <= 0) {
        this.lockedHintT = 2.5
        this.floats.push({ x: p.x, y: p.y - 40, txt: '此出口需钥匙卡！搜刮高级物资点或击杀精英守卫获取，或找青色 FAST EXIT', t: 1.8, color: '#f59e0b', big: true })
      }
    }
    if (ex) {
      this.exitProgress += dt
      const need = ex.mode === 'express' ? 1.5 : 3
      if (this.exitProgress >= need) {
        this.endRun(true, '撤离成功！带走物资价值 ' + this.lootValue)
        return
      }
    } else {
      this.exitProgress = 0
    }
    if (!this.hasKey) {
      for (const s of this.map.lootSpots) {
        if (s.tier >= 2 && !s.keyTaken && Math.hypot(s.x - p.x, s.y - p.y) < 30) {
          s.keyTaken = true
          this.hasKey = true
          this.floats.push({ x: p.x, y: p.y - 40, txt: '获得门禁钥匙卡！', t: 1.5, color: '#fde047', big: true })
          sound.play('levelup')
        }
      }
    }
  }

  // 局内将背包物品存入安全箱（死亡保留，撤离/死亡均带回仓库）
  stashToSafebox(i) {
    const p = this.player
    const it = p.bag[i]
    if (!it) return
    if (this.safebox.length >= this.safeboxCap) {
      this.floats.push({ x: p.x, y: p.y - 40, txt: '安全箱已满！', t: 1, color: '#f87171', big: true })
      return
    }
    p.bag.splice(i, 1)
    this.lootValue -= it.value
    this.safebox.push({ id: it.id, name: it.name, value: it.value, color: it.color, size: it.size, kind: it.kind || 'loot' })
    this.floats.push({ x: p.x, y: p.y - 40, txt: '已存入安全箱：' + it.name, t: 1.2, color: '#4ade80', big: true })
    sound.play('pickup')
  }

  killEnemy(e) {
    e.dead = true
    this.kills++
    // 击杀 hitstop：0.1s 时间减速
    this.hitstopT = 0.1
    this.shakeT = 0.12
    for (let i = 0; i < 14; i++) this.particles.push({ x: e.x, y: e.y, vx: rand(-120, 120), vy: rand(-120, 120), t: 0.45, color: e.d.color, size: 3.5 })
    // 击杀数字弹出
    this.floats.push({ x: e.x, y: e.y - 24, txt: '击杀 x' + this.kills, t: 0.9, color: '#fde047', big: true })
    sound.play('kill')
    if (e.d.boss) {
      this.flash = 0.4
      this.floats.push({ x: e.x, y: e.y - 30, txt: '防火墙核心瓦解！', t: 2, color: '#fde047', big: true })
      sound.play('bosskill')
      // Boss 必掉一件至尊配件（tier 3）
      const top = PARTS.filter(pt => pt.tier === 3)
      const l = top[(Math.random() * top.length) | 0]
      const p = this.player
      const load = p.bag.reduce((s2, l2) => s2 + l2.size, 0)
      if (load + l.size <= p.bagSize) {
        p.bag.push({ id: l.id, name: l.name, value: l.value, size: l.size, color: l.color, cat: l.cat, tier: l.tier, platform: l.platform || null })
        this.lootValue += l.value
        this.floats.push({ x: e.x, y: e.y - 55, txt: '拾取至尊配件：' + l.name + '（价值 ' + l.value + '）', t: 2.2, color: '#fde047', big: true })
      } else {
        this.floats.push({ x: e.x, y: e.y - 55, txt: '背包已满，至尊配件 ' + l.name + ' 无法拾取！', t: 2.2, color: '#f87171', big: true })
      }
    }
    if (e.d.elite && !this.hasKey) {
      this.hasKey = true
      this.floats.push({ x: e.x, y: e.y - 20, txt: '精英掉落钥匙卡！', t: 1.5, color: '#fde047', big: true })
    }
  }

  useMedkit() {
    const p = this.player
    if (this.medkits <= 0) {
      this.floats.push({ x: p.x, y: p.y - 30, txt: '没有医疗包！', t: 1, color: '#f87171' })
      return
    }
    if (p.hp >= p.maxHp) {
      this.floats.push({ x: p.x, y: p.y - 30, txt: '生命值已满', t: 1, color: '#94a3b8' })
      return
    }
    this.medkits--
    p.hp = Math.min(p.maxHp, p.hp + 50)
    this.floats.push({ x: p.x, y: p.y - 40, txt: '+50 HP（剩 ' + this.medkits + ' 个）', t: 1.2, color: '#4ade80', big: true })
    sound.play('levelup')
    for (let i = 0; i < 8; i++) this.particles.push({ x: p.x, y: p.y, vx: rand(-40, 40), vy: rand(-60, -10), t: 0.5, color: '#4ade80', size: 2.5 })
  }

  useStim() {
    const p = this.player
    if (this.stims <= 0) {
      this.floats.push({ x: p.x, y: p.y - 30, txt: '没有肾上腺素！', t: 1, color: '#f87171' })
      return
    }
    this.stims--
    p.stimT = 5
    p.stamina = 100
    this.floats.push({ x: p.x, y: p.y - 40, txt: '肾上腺素！移速提升 5 秒', t: 1.2, color: '#a3e635', big: true })
    sound.play('levelup')
  }

  useEmp() {
    const p = this.player
    if (this.emps <= 0) {
      this.floats.push({ x: p.x, y: p.y - 30, txt: '没有 EMP 手雷！', t: 1, color: '#f87171' })
      return
    }
    this.emps--
    this.shakeT = 0.15
    this.floats.push({ x: p.x, y: p.y - 40, txt: 'EMP 爆发！范围内敌人瘫痪 3 秒', t: 1.4, color: '#22d3ee', big: true })
    sound.play('boss')
    for (let i = 0; i < 12; i++) this.particles.push({ x: p.x, y: p.y, vx: rand(-160, 160), vy: rand(-160, 160), t: 0.4, color: '#22d3ee', size: 2.5 })
    for (const e of this.enemies) {
      if (e.dead) continue
      if (Math.hypot(e.x - p.x, e.y - p.y) < 260) {
        e.stunT = 3
        e.state = 'search'
        e.lastSeen = { x: p.x, y: p.y }
        e.alertMark = '?'
        e.alertMarkT = 1
      }
    }
  }

  hurtPlayer(dmg) {
    const p = this.player
    if (p.invuln > 0 || p.dead) return
    const real = Math.max(1, Math.round(dmg * (this.armorMul || 1)))
    p.hp -= real
    p.invuln = 0.35
    this.flash = 0.3
    this.shakeT = 0.15
    sound.play('hurt')
    // 受击方向：记录方位 + 立体声提示音
    if (this.lastHitAng !== undefined) {
      this.hitDir = this.lastHitAng
      this.hitDirT = 0.9
      sound.beepPan(200, 0.12, 'sawtooth', 0.07, 90, Math.sin(this.hitDir - p.face))
      this.lastHitAng = undefined
    }
    this.floats.push({ x: p.x, y: p.y - 26, txt: '-' + real, t: 0.7, color: '#f87171' })
    if (p.hp <= 0) {
      p.dead = true
      this.endRun(false, '任务失败——装备与物资掉落在封锁区')
    }
  }

  endRun(win, msg) {
    if (this.state !== 'playing') return
    this.state = win ? 'win' : 'dead'
    sound.play(win ? 'win' : 'over')
    try {
      if (!win) {
        localStorage.setItem('duckov_corpse', JSON.stringify({ x: this.player.x, y: this.player.y, value: this.lootValue, bag: this.player.bag }))
      } else {
        localStorage.removeItem('duckov_corpse')
      }
      const best = JSON.parse(localStorage.getItem('duckov_best') || '{}')
      if (win && this.lootValue > (best.value || 0)) {
        localStorage.setItem('duckov_best', JSON.stringify({ value: this.lootValue, kills: this.kills, time: this.time }))
      }
    } catch (err) {
      // localStorage 不可用时忽略
    }
    this.onEnd({ win, msg, value: this.lootValue, kills: this.kills, time: this.time })
  }

  hudData() {
    const p = this.player
    const w = WEAPONS[p.weapon]
    return {
      hp: p.hp, maxHp: p.maxHp,
      ammo: w.mag === Infinity ? '∞' : (p.reloadT > 0 ? '装填' : p.ammo[p.weapon]),
      mag: w.mag === Infinity ? '∞' : w.mag,
      reloading: p.reloadT > 0,
      reloadPct: p.reloadT > 0 ? Math.max(0, 1 - p.reloadT / (w.reload || 1)) : 0,
      weapon: w.name,
      weaponId: p.weapon,
      armor: this.armorName || '',
      armorId: this.armorId || '',
      bag: p.bag.reduce((s, l) => s + l.size, 0), bagSize: p.bagSize,
      value: this.lootValue,
      exitT: Math.max(0, this.exitT),
      hasKey: this.hasKey,
      stamina: p.stamina,
      medkits: this.medkits,
      stims: this.stims,
      emps: this.emps,
      alert: this.alert,
      blackout: this.blackout > 0
    }
  }

  render() {
    if (this.renderer) this.renderer(this.ctx, this)
  }
}

function segAabb(ox, oy, dx, dy, w, maxD) {
  let tmin = -Infinity
  let tmax = maxD
  if (Math.abs(dx) < 1e-9) {
    if (ox < w.x || ox > w.x + w.w) return null
  } else {
    let t1 = (w.x - ox) / dx
    let t2 = (w.x + w.w - ox) / dx
    if (t1 > t2) {
      const t = t1
      t1 = t2
      t2 = t
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < w.y || oy > w.y + w.h) return null
  } else {
    let t1 = (w.y - oy) / dy
    let t2 = (w.y + w.h - oy) / dy
    if (t1 > t2) {
      const t = t1
      t1 = t2
      t2 = t
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
  }
  if (tmax < 0 || tmin > tmax) return null
  return tmin > 0 ? tmin : null
}
