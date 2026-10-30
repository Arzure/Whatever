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
  pistol: { name: '运维手枪', dmg: 24, cd: 0.32, speed: 520, spread: 0.04, mag: Infinity, noise: 180, color: '#67e8f9' },
  smg: { name: '散热冲锋枪', dmg: 13, cd: 0.11, speed: 560, spread: 0.12, mag: 30, reload: 1.4, noise: 260, color: '#fbbf24' },
  shotgun: { name: '脉冲霰弹', dmg: 12, pellets: 6, cd: 0.85, speed: 460, spread: 0.34, mag: 6, reload: 1.8, noise: 340, color: '#f472b6' },
  railgun: { name: '轨道炮', dmg: 90, cd: 1.1, speed: 760, spread: 0, mag: 5, reload: 2.0, noise: 420, color: '#c084fc' }
}

// 物资定义：价值/体积
export const LOOTS = {
  ram: { name: '内存条', value: 40, size: 1, color: '#22d3ee', tier: 0 },
  disk: { name: '机械硬盘', value: 80, size: 2, color: '#94a3b8', tier: 1 },
  gpu: { name: 'GPU 显卡', value: 220, size: 3, color: '#4ade80', tier: 2 },
  core: { name: '量子核心', value: 500, size: 4, color: '#fde047', tier: 3 }
}

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
    this.blackout = 0
    this.blackoutT = rand(50, 80)
    this.alert = 0
    this.kills = 0
    this.lootValue = 0
    this.hasKey = false
    this.armorMul = cfg.armorMul || 1
    this.medkits = cfg.medkits || 0
    this.player = {
      x: this.map.playerSpawn.x, y: this.map.playerSpawn.y, r: 12,
      hp: 100, maxHp: 100,
      speed: 175, face: 0,
      weapon: 'pistol', ammo: {}, reloadT: 0, fireT: 0,
      stamina: 100, dashT: 0, dashCd: 0,
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
    if (this.state === 'playing' && !this.paused) {
      try {
        this.update(dt)
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
    let spd = p.speed * loadMul * coolMul
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
          this.bullets.push({ x: p.x + Math.cos(p.face) * 16, y: p.y + Math.sin(p.face) * 16, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, r: 3, dmg: w.dmg, life: 1.2, color: w.color })
        }
        sound.play('shoot')
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
        for (let i = 0; i < 3; i++) this.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), t: 0.15, color: b.color, size: 2 })
        b.dead = true
        continue
      }
      for (const pr of this.map.props) {
        if (pr.hp <= 0) continue
        if (b.x > pr.x && b.x < pr.x + pr.w && b.y > pr.y && b.y < pr.y + pr.h) {
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
          e.hp -= b.dmg
          e.flashT = 0.08
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

  updateInteract(dt) {
    const p = this.player
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
        const keys = Object.keys(LOOTS).filter(k => LOOTS[k].tier <= near.tier)
        const id = keys[Math.min(keys.length - 1, near.tier >= 3 ? 3 : (Math.random() * keys.length) | 0)]
        const l = LOOTS[id]
        const load = p.bag.reduce((s2, l2) => s2 + l2.size, 0)
        if (load + l.size > p.bagSize) {
          // 背包满：不消耗搜刮点，物资保留原地
          this.floats.push({ x: p.x, y: p.y - 40, txt: '背包已满！先丢弃低价值物品', t: 1.2, color: '#f87171', big: true })
        } else {
          near.opened = true
          p.bag.push({ id, name: l.name, value: l.value, size: l.size, color: l.color })
          this.lootValue += l.value
          this.floats.push({ x: p.x, y: p.y - 40, txt: '获得 ' + l.name + '（价值 ' + l.value + '）', t: 1.2, color: l.color, big: true })
          sound.play('pickup')
          makeNoise(this, p.x, p.y, 150)
        }
      }
    } else {
      this.openT = 0
    }
    let ex = null
    for (const e of this.map.exits) {
      if (e.needKey && !this.hasKey) continue
      if (Math.hypot(e.x - p.x, e.y - p.y) < 46) {
        ex = e
        break
      }
    }
    this.exitTarget = ex
    if (ex) {
      this.exitProgress += dt
      if (this.exitProgress >= 3) {
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

  killEnemy(e) {
    e.dead = true
    this.kills++
    this.shakeT = 0.12
    for (let i = 0; i < 10; i++) this.particles.push({ x: e.x, y: e.y, vx: rand(-90, 90), vy: rand(-90, 90), t: 0.4, color: e.d.color, size: 3 })
    sound.play('hit')
    if (e.d.boss) {
      this.flash = 0.4
      this.floats.push({ x: e.x, y: e.y - 30, txt: '防火墙核心瓦解！', t: 2, color: '#fde047', big: true })
      sound.play('bosskill')
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

  hurtPlayer(dmg) {
    const p = this.player
    if (p.invuln > 0 || p.dead) return
    const real = Math.max(1, Math.round(dmg * (this.armorMul || 1)))
    p.hp -= real
    p.invuln = 0.35
    this.flash = 0.3
    this.shakeT = 0.15
    sound.play('hurt')
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
      weapon: w.name,
      bag: p.bag.reduce((s, l) => s + l.size, 0), bagSize: p.bagSize,
      value: this.lootValue,
      exitT: Math.max(0, this.exitT),
      hasKey: this.hasKey,
      stamina: p.stamina,
      medkits: this.medkits,
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
