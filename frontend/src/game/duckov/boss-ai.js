/* ============================================================
 * 逃离鹅科夫 · Boss AI 模块
 * 防火墙核心专属状态机、招式表和防御节点
 * 从 entities.js 抽离，供 updateEnemy 调用
 * ============================================================ */
import { sound } from '../audio.js'

const TAU = Math.PI * 2
const rand = (a, b) => a + Math.random() * (b - a)

// Boss 招式表：顺序轮换
export const BOSS_MOVES = [
  { id: 'ring', name: '环形弹幕' },
  { id: 'fan', name: '扇形扫射' },
  { id: 'homing', name: '追踪弹' },
  { id: 'charge', name: '直线冲撞' },
  { id: 'laser', name: '激光扫射' },
  { id: 'summon', name: '召唤小怪' }
]

// Boss 防御节点世界坐标（与渲染/命中判定共用同一公式）
export function bossNodePos(e, n, time) {
  const a = n.ang + time * 0.6
  return { x: e.x + Math.cos(a) * (e.r + 26), y: e.y + Math.sin(a) * (e.r + 26) }
}

// Boss 专属状态机：move → telegraph(前摇) → attack → overheat(过热)/stun(撞墙硬直) → move
// 输出窗口：过热 2s 与撞墙硬直 1.5s 期间受伤 ×1.5（game.js 侧应用）
export function updateBoss(game, e, dt, seen, distP, aim) {
  const p = game.player
  if (!e.bossState) {
    e.bossState = 'move'
    e.bossT = 0
    e.bossMoveIdx = 0
    e.bossNodes = [0, 1, 2, 3].map(i => ({ ang: i * Math.PI / 2, hp: 80, maxHp: 80, alive: true, regenT: 0 }))
    // 首次激活：入场冲击波 + 全屏震动
    if (!e.bossIntroDone) {
      e.bossIntroDone = true
      game.bossIntroT = 1.5
      game.shakeT = 0.3
      game.flash = 0.25
      game.hitstopT = Math.max(game.hitstopT, 0.2)
      if (game.floats) game.floats.push({ x: e.x, y: e.y - 56, txt: '⚠ 防火墙核心已激活！', t: 2, color: '#ef4444', big: true })
    }
  }
  e.bossT += dt
  // 防御节点再生
  for (const n of e.bossNodes) {
    if (!n.alive) {
      n.regenT -= dt
      if (n.regenT <= 0) { n.alive = true; n.hp = n.maxHp }
    }
  }
  const spd = e.d.speed * (e.raged ? 1.4 : 1)
  let mvx = 0, mvy = 0

  if (e.bossState === 'move') {
    // 走位：保持中距离
    if (seen) e.face = lerpAngle(e.face, aim, 6 * dt)
    const ideal = e.d.range * 0.6
    if (distP > ideal + 40) { mvx = Math.cos(aim); mvy = Math.sin(aim) }
    else if (distP < ideal - 60) { mvx = -Math.cos(aim); mvy = -Math.sin(aim) }
    if (e.bossT > 2.2) {
      e.bossState = 'telegraph'
      e.bossT = 0
      e.bossNextMove = BOSS_MOVES[e.bossMoveIdx % BOSS_MOVES.length]
      e.bossMoveIdx++
      sound.play('bosstele')
      if (game.floats) game.floats.push({ x: e.x, y: e.y - 52, txt: '⚠ ' + e.bossNextMove.name + '！', t: 0.9, color: '#fde047', big: true })
    }
  } else if (e.bossState === 'telegraph') {
    // 前摇 0.8s：面向玩家蓄力（可预判）
    if (seen) e.face = lerpAngle(e.face, aim, 10 * dt)
    if (e.bossT >= 0.8) {
      e.bossState = 'attack'
      e.bossT = 0
      e.bossFanCount = 0
      if (e.bossNextMove.id === 'charge') {
        e.bossChargeDir = aim
        sound.play('bosscharge')
      }
    }
  } else if (e.bossState === 'attack') {
    const mv = e.bossNextMove.id
    if (mv === 'ring') {
      // 环形弹幕：一圈 16 发
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU + rand(-0.05, 0.05)
        game.ebullets.push({ x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6), vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 4, dmg: Math.round(e.d.dmg * 0.6), life: 2.6, color: '#fca5a5', owner: e })
      }
      makeNoise(game, e.x, e.y, 200)
      e.bossState = 'overheat'; e.bossT = 0
      sound.play('bossoverheat')
    } else if (mv === 'fan') {
      // 扇形扫射：5 波 × 5 发，120° 扫过
      if (e.bossT > e.bossFanCount * 0.14) {
        const sweep = -Math.PI / 3 + (e.bossFanCount / 4) * (Math.PI * 2 / 3)
        const base = e.face + sweep
        for (let i = -2; i <= 2; i++) {
          const a = base + i * 0.14
          game.ebullets.push({ x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6), vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 4, dmg: Math.round(e.d.dmg * 0.5), life: 2.2, color: '#fca5a5', owner: e })
        }
        e.bossFanCount++
        makeNoise(game, e.x, e.y, 150)
        if (e.bossFanCount >= 5) { e.bossState = 'overheat'; e.bossT = 0; sound.play('bossoverheat') }
      }
    } else if (mv === 'homing') {
      // 追踪弹：3 发慢速追踪
      for (let i = 0; i < 3; i++) {
        const a = aim + (i - 1) * 0.5
        game.ebullets.push({ x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6), vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, r: 5, dmg: Math.round(e.d.dmg * 0.7), life: 4, color: '#f87171', homing: true, owner: e })
      }
      makeNoise(game, e.x, e.y, 200)
      e.bossState = 'overheat'; e.bossT = 0
      sound.play('bossoverheat')
    } else if (mv === 'charge') {
      // 直线冲撞：撞墙/撞人 → 硬直
      const dir = e.bossChargeDir
      const expect = 420 * dt
      const c = game.collideWalls(e.x + Math.cos(dir) * expect, e.y + Math.sin(dir) * expect, e.r)
      const moved = Math.hypot(c.x - e.x, c.y - e.y)
      e.x = c.x; e.y = c.y
      if (Math.random() < 0.7) game.particles.push({ x: e.x + rand(-14, 14), y: e.y + rand(-14, 14), vx: rand(-30, 30), vy: rand(-30, 30), t: 0.3, color: '#dc2626', size: 3 })
      if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r + 4) {
        game.hurtPlayer(e.d.dmg)
        e.bossState = 'stun'; e.bossT = 0
        game.shakeT = 0.25
        sound.play('bossstun')
        if (game.floats) game.floats.push({ x: e.x, y: e.y - 52, txt: '冲撞结束！全力输出！', t: 1.4, color: '#4ade80', big: true })
      } else if (moved < expect * 0.4 || e.bossT > 1.4) {
        e.bossState = 'stun'; e.bossT = 0
        game.shakeT = 0.25
        sound.play('bossstun')
        if (game.floats) game.floats.push({ x: e.x, y: e.y - 52, txt: '撞墙硬直！全力输出！', t: 1.4, color: '#4ade80', big: true })
      }
    } else if (mv === 'laser') {
      // 激光扫射：从当前朝向扫 180°（持续 0.8s），被扫到受伤
      if (e.bossT < 0.1) sound.play('bosscharge')
      const sweepAng = e.face - Math.PI / 2 + (e.bossT / 0.8) * Math.PI
      const laserLen = e.d.range
      for (let j = -3; j <= 3; j++) {
        const aa = sweepAng + j * 0.06
        game.ebullets.push({
          x: e.x + Math.cos(aa) * (e.r + 6), y: e.y + Math.sin(aa) * (e.r + 6),
          vx: Math.cos(aa) * 2, vy: Math.sin(aa) * 2,
          r: 3, dmg: Math.round(e.d.dmg * 0.6), life: 0.12, color: '#ef4444', owner: e
        })
      }
      // 碰撞检测激光束命中玩家
      const ex = e.x + Math.cos(sweepAng) * (e.r + 6)
      const ey = e.y + Math.sin(sweepAng) * (e.r + 6)
      if (Math.hypot(p.x - ex, p.y - ey) < laserLen + 8) {
        const t = Math.max(0, Math.min(1, ((p.x - ex) * Math.cos(sweepAng) + (p.y - ey) * Math.sin(sweepAng)) / laserLen))
        if (Math.abs((p.x - ex) * Math.sin(sweepAng) - (p.y - ey) * Math.cos(sweepAng)) < 16 + p.r && t < 1) {
          if (!e.laserHitT) e.laserHitT = 0
          if (e.laserHitT < e.bossT - 0.15) {
            e.laserHitT = e.bossT
            game.hurtPlayer(Math.round(e.d.dmg * 0.6))
          }
        }
      }
      if (e.bossT >= 0.8) { e.bossState = 'overheat'; e.bossT = 0; sound.play('bossoverheat'); e.laserHitT = 0 }
    } else if (mv === 'summon') {
      // 召唤小怪：在 Boss 周围刷 3 只 low-tier 巡逻兵
      if (e.bossT <= dt) {
        sound.play('bosscharge')
        for (let i = 0; i < 3; i++) {
          const sa = rand(0, TAU)
          const sd = 60 + rand(0, 40)
          const spawn = { x: e.x + Math.cos(sa) * sd, y: e.y + Math.sin(sa) * sd }
          const c = game.collideWalls(spawn.x, spawn.y, 10)
          const newE = createEnemyRef({ x: c.x, y: c.y, kind: 'patrol', roomId: e.homeRoom }, game.map)
          newE.state = 'combat'
          newE.lastSeen = { x: p.x, y: p.y }
          game.enemies.push(newE)
        }
        if (game.floats) game.floats.push({ x: e.x, y: e.y - 52, txt: '增援抵达！', t: 1.2, color: '#f87171', big: true })
      }
      e.bossState = 'overheat'; e.bossT = 0
      sound.play('bossoverheat')
    }
  } else if (e.bossState === 'overheat') {
    // 过热 2s：停火漂移（输出窗口）+ 泄压粒子
    for (let i = 0; i < 3; i++) {
      const pa = rand(0, TAU)
      game.particles.push({
        x: e.x + Math.cos(pa) * (e.r + rand(2, 10)),
        y: e.y + Math.sin(pa) * (e.r + rand(2, 10)),
        vx: Math.cos(pa) * rand(20, 60),
        vy: Math.sin(pa) * rand(20, 60),
        t: rand(0.25, 0.5), color: '#fca5a5', size: rand(2, 5)
      })
    }
    if (e.bossT >= 2) { e.bossState = 'move'; e.bossT = 0 }
  } else if (e.bossState === 'stun') {
    // 撞墙硬直 1.5s（输出窗口）
    if (e.bossT >= 1.5) { e.bossState = 'move'; e.bossT = 0 }
  }

  // move/overheat 状态的通用移动
  if ((e.bossState === 'move' || e.bossState === 'overheat') && (mvx || mvy)) {
    const m = Math.hypot(mvx, mvy) || 1
    const c = game.collideWalls(e.x + mvx / m * spd * dt, e.y + mvy / m * spd * dt, e.r)
    e.x = c.x; e.y = c.y
  }
}

// 供 updateBoss 内 summon 招式引用（由 entities.js 注入）
let createEnemyRef = null
export function setCreateEnemy(fn) { createEnemyRef = fn }

// 供 updateBoss 内引用 makeNoise（由 entities.js 注入，避免循环依赖）
let makeNoiseRef = null
export function setMakeNoise(fn) { makeNoiseRef = fn }
function makeNoise(game, x, y, radius) {
  if (makeNoiseRef) makeNoiseRef(game, x, y, radius)
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return a + d * Math.min(1, t)
}
