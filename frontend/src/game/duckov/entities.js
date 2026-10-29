/* ============================================================
 * 逃离鹅科夫 · 敌人实体与行为状态机
 * 巡逻 → 警戒(?) → 交战(!) → 搜索 → 回巡逻；领地约束不跨房追击
 * ============================================================ */

export const ENEMY_KINDS = {
  patrol: { name: '巡逻进程', hp: 40, dmg: 8, speed: 70, r: 11, color: '#f59e0b', range: 260, fireCd: 1.2, bullet: 240, melee: false, sight: 300, fov: 1.1 },
  guard: { name: '守卫进程', hp: 70, dmg: 12, speed: 55, r: 13, color: '#ef4444', range: 200, fireCd: 1.6, bullet: 280, melee: false, sight: 260, fov: 1.3 },
  elite: { name: '精英守卫', hp: 220, dmg: 18, speed: 62, r: 17, color: '#a855f7', range: 240, fireCd: 0.9, bullet: 320, melee: false, sight: 320, fov: 1.4, elite: true },
  boss: { name: '防火墙核心', hp: 1400, dmg: 26, speed: 46, r: 30, color: '#dc2626', range: 300, fireCd: 1.1, bullet: 300, melee: false, sight: 400, fov: Math.PI, boss: true }
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
  }
  return {
    kind: spawn.kind, d: k,
    x: spawn.x, y: spawn.y, r: k.r,
    hp: k.hp, maxHp: k.hp,
    face: rand(0, TAU),
    state: 'patrol', // patrol / alert / combat / search
    stateT: 0, wpIdx: 0, waypoints,
    homeRoom: spawn.room,
    lastSeen: null, investT: 0, fireT: rand(0.3, 1),
    flashT: 0, dead: false, alertMark: 0, alertMarkT: 0
  }
}

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
  if (e.alertMarkT > 0) e.alertMarkT -= dt
  e.stateT += dt
  const seen = !p.dead && canSee(game, e, p.x, p.y)
  const distP = Math.hypot(p.x - e.x, p.y - e.y)
  const home = game.map.rooms.find(r => r.id === e.homeRoom)

  // ---- 状态转移 ----
  if (seen) {
    if (e.state !== 'combat') {
      e.state = 'combat'; e.stateT = 0
      e.alertMark = '!'; e.alertMarkT = 1.5
      game.onSpotted(e)
    }
    e.lastSeen = { x: p.x, y: p.y }
  } else if (e.state === 'combat' && e.stateT > 3) {
    e.state = 'search'; e.stateT = 0
  }

  let mvx = 0, mvy = 0
  let spd = e.d.speed

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
    if (e.lastSeen) {
      const dx = e.lastSeen.x - e.x, dy = e.lastSeen.y - e.y
      const d = Math.hypot(dx, dy)
      if (d > 20) { mvx = dx / d; mvy = dy / d; spd *= 1.3 }
      e.face = lerpAngle(e.face, Math.atan2(dy, dx), 5 * dt)
    }
    e.investT -= dt
    if (e.investT <= 0 || (d < 24)) { e.state = 'search'; e.stateT = 0; e.investT = 4 }
  } else if (e.state === 'combat') {
    // 交战：面向玩家，保持射程距离拉扯（远程怪）
    const aim = Math.atan2(p.y - e.y, p.x - e.x)
    e.face = lerpAngle(e.face, aim, 8 * dt)
    const ideal = e.d.range * 0.7
    if (distP > ideal + 30) { mvx = Math.cos(aim); mvy = Math.sin(aim) }
    else if (distP < ideal - 40) { mvx = -Math.cos(aim); mvy = -Math.sin(aim) }
    else {
      // 横向绕走（拉扯走位）
      mvx = Math.cos(aim + Math.PI / 2) * (e.x % 2 < 1 ? 1 : -1)
      mvy = Math.sin(aim + Math.PI / 2) * (e.x % 2 < 1 ? 1 : -1)
    }
    // 领地约束：离领地中心太远则回防（Boss 死守）
    if (home && !e.d.boss) {
      const dh = Math.hypot(e.x - home.cx, e.y - home.cy)
      if (dh > Math.max(home.w, home.h) * 0.9) {
        const back = Math.atan2(home.cy - e.y, home.cx - e.x)
        mvx = Math.cos(back); mvy = Math.sin(back)
      }
    }
    // 射击
    e.fireT -= dt
    if (e.fireT <= 0 && seen && distP < e.d.range) {
      e.fireT = e.d.fireCd
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
