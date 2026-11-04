/* ============================================================
 * 逃离鹅科夫 · 敌人实体与行为状态机
 * 巡逻 → 警戒(?) → 交战(!) → 搜索 → 回巡逻；领地约束不跨房追击
 * ============================================================ */
import { sound } from '../audio.js'
import { BOSS_MOVES, bossNodePos, updateBoss, setCreateEnemy, setMakeNoise } from './boss-ai.js'

export const ENEMY_KINDS = {
  patrol: { name: '巡逻进程', hp: 40, dmg: 8, speed: 70, r: 11, color: '#f59e0b', range: 260, fireCd: 1.2, bullet: 240, melee: false, sight: 300, fov: 1.1 },
  guard: { name: '守卫进程', hp: 70, dmg: 12, speed: 55, r: 13, color: '#ef4444', range: 200, fireCd: 1.6, bullet: 280, melee: false, sight: 260, fov: 1.3 },
  elite: { name: '精英守卫', hp: 220, dmg: 18, speed: 62, r: 17, color: '#a855f7', range: 240, fireCd: 0.9, bullet: 320, melee: false, sight: 320, fov: 1.4, elite: true },
  boss: { name: '防火墙核心', hp: 800, dmg: 26, speed: 46, r: 30, color: '#dc2626', range: 300, fireCd: 1.1, bullet: 300, melee: false, sight: 400, fov: Math.PI, boss: true },
  drone: { name: '侦察无人机', hp: 26, dmg: 6, speed: 105, r: 9, color: '#38bdf8', range: 170, fireCd: 0.7, bullet: 210, melee: false, sight: 340, fov: 1.6, drone: true },
  sniper: { name: '狙击进程', hp: 55, dmg: 34, speed: 48, r: 12, color: '#f43f5e', range: 420, fireCd: 2.4, bullet: 520, melee: false, sight: 460, fov: 0.7, sniper: true },
  rusher: { name: '狂暴进程', hp: 60, dmg: 16, speed: 128, r: 11, color: '#fb7185', range: 30, fireCd: 0.8, bullet: 0, melee: true, sight: 320, fov: 1.5, rusher: true },
  bomber: { name: '自爆程序', hp: 34, dmg: 45, speed: 92, r: 12, color: '#f97316', range: 34, fireCd: 1, bullet: 0, melee: false, sight: 300, fov: 1.6, bomber: true }
}

const TAU = Math.PI * 2
const rand = (a, b) => a + Math.random() * (b - a)

// 创建敌人实例（spawn 来自 mapgen 的 spawns 项）
export function createEnemy(spawn, map) {
  const k = ENEMY_KINDS[spawn.kind]
  const room = map.rooms.find(r => r.id === spawn.room)
  // 巡逻路径点：房间内随机 3 点
  const waypoints = []
  if (room) {
    for (let i = 0; i < 3; i++) waypoints.push({ x: rand(room.x + 40, room.x + room.w - 40), y: rand(room.y + 40, room.y + room.h - 40) })
    // 巡逻路径延伸至门口：敌人会走到房间出入口附近张望，不再站桩打转
    if (room.doors && room.doors.length) {
      const d = room.doors[(Math.random() * room.doors.length) | 0]
      if (d.dir === 'v') waypoints.push({ x: d.x < room.cx ? room.x + 70 : room.x + room.w - 70, y: d.y })
      else waypoints.push({ x: d.x, y: d.y < room.cy ? room.y + 70 : room.y + room.h - 70 })
    }
  }
  // 注入 boss-ai 模块所需依赖（避免循环引用）
  setCreateEnemy(createEnemySelf)
  setMakeNoise(makeNoiseInner)
  return {
    kind: spawn.kind, d: k,
    x: spawn.x, y: spawn.y, r: k.r,
    hp: k.hp, maxHp: k.hp,
    face: rand(0, TAU),
    state: 'patrol', // patrol / alert / combat / search
    stateT: 0, wpIdx: 0, waypoints,
    homeRoom: spawn.room,
    lastSeen: null, investT: 0, fireT: rand(0.3, 1),
    flashT: 0, dead: false, alertMark: 0, alertMarkT: 0, stunT: 0,
    chargeT: rand(2, 4), chargeD: 0, raged: false
  }
}
// 自引用 + 预声明，供 boss-ai 依赖注入
function createEnemySelf(spawn, map) { return createEnemy(spawn, map) }
function makeNoiseInner(game, x, y, r) { makeNoise(game, x, y, r) }

// Boss 招式表：顺序轮换
// BOSS_MOVES / bossNodePos / updateBoss → 已抽离至 boss-ai.js（re-export 保证兼容）
export { BOSS_MOVES, bossNodePos } from './boss-ai.js'

// 视野检测：扇形 + 无墙遮挡（射线采样）
export function canSee(game, e, tx, ty) {
  const dx = tx - e.x, dy = ty - e.y
  const dist = Math.hypot(dx, dy)
  if (dist > e.d.sight) return false
  const a = Math.atan2(dy, dx)
  let da = a - e.face
  while (da > Math.PI) da -= TAU
  while (da < -Math.PI) da += TAU
  if (Math.abs(da) > e.d.fov && dist > 60) return false
  return game.lineClear(e.x, e.y, tx, ty)
}

// 噪音传播：产生噪音圈，范围内敌人进入警戒并前往调查
export function makeNoise(game, x, y, radius) {
  game.noiseRings.push({ x, y, r: 0, max: radius, t: 0.6 })
  for (const e of game.enemies) {
    if (e.dead || e.state === 'combat') continue
    if (Math.hypot(e.x - x, e.y - y) < radius) {
      e.state = 'alert'
      e.stateT = 0
      e.lastSeen = { x, y }
      e.investT = 6
      e.alertMark = '?'; e.alertMarkT = 1.2
    }
  }
}

// 敌人 AI 更新（每帧）：状态机推进
export function updateEnemy(game, e, dt) {
  const p = game.player
  if (e.flashT > 0) e.flashT -= dt
  // EMP 眩晕：不动不射，仅缓慢恢复
  if (e.stunT > 0) {
    e.stunT -= dt
    e.face += 4 * dt
    return
  }
  if (e.alertMarkT > 0) e.alertMarkT -= dt
  e.stateT += dt
  const seen = !p.dead && canSee(game, e, p.x, p.y)
  const distP = Math.hypot(p.x - e.x, p.y - e.y)
  const home = game.map.rooms.find(r => r.id === e.homeRoom)

  // ---- 状态转移 ----
  // Boss 狂暴阶段：血量低于 50% 提速 40%、射速加快
  if (e.d.boss && !e.raged && e.hp < e.maxHp * 0.5) {
    e.raged = true
    e.alertMark = '!!'; e.alertMarkT = 2
    sound.play('bossrage')
    if (game.floats) game.floats.push({ x: e.x, y: e.y - 46, txt: '⚠ 防火墙核心狂暴！', t: 2, color: '#fde047', big: true })
  }
  if (seen) {
    if (e.state !== 'combat') {
      e.state = 'combat'; e.stateT = 0
      e.alertMark = '!'; e.alertMarkT = 1.5
      game.onSpotted(e)
      // 小队联动：唤醒附近队友一同前往玩家位置
      for (const ally of game.enemies) {
        if (ally === e || ally.dead || ally.state === 'combat') continue
        if (Math.hypot(ally.x - e.x, ally.y - e.y) < 280) {
          ally.state = 'alert'
          ally.stateT = 0
          ally.lastSeen = { x: p.x, y: p.y }
          ally.investT = 6
          ally.alertMark = '!'; ally.alertMarkT = 1.2
        }
      }
    }
    e.lastSeen = { x: p.x, y: p.y }
  } else if (e.state === 'combat' && e.stateT > 3) {
    e.state = 'search'; e.stateT = 0; e.investT = 5
  }

  // ---- Boss 专属状态机：进入交战后替代普通敌人逻辑 ----
  if (e.d.boss && e.state === 'combat') {
    const aimB = Math.atan2(p.y - e.y, p.x - e.x)
    updateBoss(game, e, dt, seen, distP, aimB)
    return
  }

  let mvx = 0, mvy = 0
  let spd = e.d.speed * (e.raged ? 1.4 : 1)

  if (e.state === 'patrol') {
    // 沿路径点巡逻（领地内）
    const wp = e.waypoints[e.wpIdx]
    if (wp) {
      const dx = wp.x - e.x, dy = wp.y - e.y
      const d = Math.hypot(dx, dy)
      if (d < 14) e.wpIdx = (e.wpIdx + 1) % e.waypoints.length
      else { mvx = dx / d; mvy = dy / d }
      e.face = lerpAngle(e.face, Math.atan2(dy, dx), 3 * dt)
    }
  } else if (e.state === 'alert') {
    // 前往噪音点调查
    let dTo = Infinity
    if (e.lastSeen) {
      const dx = e.lastSeen.x - e.x, dy = e.lastSeen.y - e.y
      dTo = Math.hypot(dx, dy)
      if (dTo > 20) { mvx = dx / dTo; mvy = dy / dTo; spd *= 1.3 }
      e.face = lerpAngle(e.face, Math.atan2(dy, dx), 5 * dt)
    }
    e.investT -= dt
    if (e.investT <= 0 || dTo < 24) { e.state = 'search'; e.stateT = 0; e.investT = 5 }
  } else if (e.state === 'combat') {
    // 交战：可见时面向玩家拉扯距离；不可见时追最后目击点（不穿墙追玩家本体）
    const aim = Math.atan2(p.y - e.y, p.x - e.x)
    if (e.d.rusher) {
      // 狂暴进程：直线扑向玩家近战撕咬
      if (seen) {
        e.face = lerpAngle(e.face, aim, 10 * dt)
        if (distP > e.r + p.r + 2) { mvx = Math.cos(aim); mvy = Math.sin(aim); spd *= 1.25 }
        else {
          e.fireT -= dt
          if (e.fireT <= 0) {
            e.fireT = e.d.fireCd
            game.hurtPlayer(e.d.dmg)
          }
        }
      } else if (e.lastSeen) {
        const dx = e.lastSeen.x - e.x, dy = e.lastSeen.y - e.y
        const d = Math.hypot(dx, dy)
        if (d > 24) { mvx = dx / d; mvy = dy / d; spd *= 1.15 }
        else { e.state = 'search'; e.stateT = 0; e.investT = 5 }
      }
    } else if (e.d.bomber) {
      // 自爆程序：加速冲向玩家，贴近自爆
      if (seen) {
        e.face = lerpAngle(e.face, aim, 10 * dt)
        mvx = Math.cos(aim); mvy = Math.sin(aim)
        spd *= 1.3
        if (distP < e.d.range + p.r) {
          game.bomberExplode(e)
          return
        }
      } else if (e.lastSeen) {
        const dx = e.lastSeen.x - e.x, dy = e.lastSeen.y - e.y
        const d = Math.hypot(dx, dy)
        if (d > 24) { mvx = dx / d; mvy = dy / d; spd *= 1.15 }
        else { e.state = 'search'; e.stateT = 0; e.investT = 5 }
      }
    } else if (e.d.elite && seen) {
      // 精英守卫：周期性冲锋，贴近后爆发输出
      e.face = lerpAngle(e.face, aim, 8 * dt)
      if (e.chargeD > 0) {
        e.chargeD -= dt
        mvx = Math.cos(aim); mvy = Math.sin(aim)
        spd *= 2.6
      } else {
        e.chargeT -= dt
        const ideal = e.d.range * 0.7
        if (distP > ideal + 30) { mvx = Math.cos(aim); mvy = Math.sin(aim) }
        else if (distP < ideal - 40) { mvx = -Math.cos(aim); mvy = -Math.sin(aim) }
        if (e.chargeT <= 0 && distP < 340) { e.chargeT = 4; e.chargeD = 0.55 }
      }
    } else if (seen) {
      e.face = lerpAngle(e.face, aim, 8 * dt)
      const ideal = e.d.range * 0.7
      if (distP > ideal + 30) { mvx = Math.cos(aim); mvy = Math.sin(aim) }
      else if (distP < ideal - 40) { mvx = -Math.cos(aim); mvy = -Math.sin(aim) }
      else {
        // 横向绕走（拉扯走位）
        mvx = Math.cos(aim + Math.PI / 2) * (e.x % 2 < 1 ? 1 : -1)
        mvy = Math.sin(aim + Math.PI / 2) * (e.x % 2 < 1 ? 1 : -1)
      }
    } else if (e.lastSeen) {
      // 丢失视野：前往最后目击点搜索
      const dx = e.lastSeen.x - e.x, dy = e.lastSeen.y - e.y
      const d = Math.hypot(dx, dy)
      e.face = lerpAngle(e.face, Math.atan2(dy, dx), 6 * dt)
      if (d > 24) { mvx = dx / d; mvy = dy / d; spd *= 1.15 }
      else { e.state = 'search'; e.stateT = 0; e.investT = 5 }
    }
    // 领地约束：离领地中心太远则回防（Boss 死守）
    if (home && !e.d.boss) {
      const dh = Math.hypot(e.x - home.cx, e.y - home.cy)
      if (dh > Math.max(home.w, home.h) * 0.9) {
        const back = Math.atan2(home.cy - e.y, home.cx - e.x)
        mvx = Math.cos(back); mvy = Math.sin(back)
      }
    }
    // 射击（仅可见时）；狙击手需先锁定 0.8s
    e.fireT -= dt
    if (e.d.sniper) {
      if (seen && distP < e.d.range) {
        e.aimT = (e.aimT || 0) + dt
        if (e.aimT >= 0.8 && e.fireT <= 0) {
          e.fireT = e.d.fireCd
          e.aimT = 0
          game.enemyShoot(e, aim)
        }
      } else e.aimT = 0
    } else if (e.fireT <= 0 && seen && distP < e.d.range) {
      e.fireT = e.d.fireCd * (e.d.boss && e.raged ? 0.6 : 1)
      game.enemyShoot(e, aim)
    }
  } else if (e.state === 'search') {
    // 最后目击点附近搜索
    if (e.lastSeen) {
      const dx = e.lastSeen.x - e.x, dy = e.lastSeen.y - e.y
      const d = Math.hypot(dx, dy)
      if (d > 26) { mvx = dx / d; mvy = dy / d; spd *= 0.8 }
      else {
        // 原地环视
        e.face += 2.2 * dt
        e.investT -= dt
        if (e.investT <= 0) { e.state = 'patrol'; e.stateT = 0; e.lastSeen = null }
      }
      e.face = lerpAngle(e.face, Math.atan2(dy, dx), 4 * dt)
    } else { e.state = 'patrol' }
  }

  // 移动 + 撞墙滑动
  if (mvx || mvy) {
    const m = Math.hypot(mvx, mvy) || 1
    let nx = e.x + (mvx / m) * spd * dt
    let ny = e.y + (mvy / m) * spd * dt
    const c = game.collideWalls(nx, ny, e.r)
    e.x = c.x; e.y = c.y
  }
}

function lerpAngle(a, b, t) {
  let da = b - a
  while (da > Math.PI) da -= TAU
  while (da < -Math.PI) da += TAU
  return a + da * Math.min(1, t)
}
