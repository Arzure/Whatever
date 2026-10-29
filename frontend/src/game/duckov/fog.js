/* ============================================================
 * 逃离鹅科夫 · 战争迷雾
 * 射线投射计算可见多边形；未探索=黑，已探索不可见=半透明记忆
 * ============================================================ */

const TAU = Math.PI * 2

// 对墙角顶点发射射线，计算可见多边形顶点序列
export function computeFov(game, ox, oy, radius) {
  const walls = game.map.walls
  const pts = []
  // 收集墙顶点 + 玩家周围基准角
  const angles = []
  for (let i = 0; i < 16; i++) angles.push(i / 16 * TAU)
  for (const w of walls) {
    // 只处理视野半径内的墙
    if (w.x > ox + radius || w.x + w.w < ox - radius || w.y > oy + radius || w.y + w.h < oy - radius) continue
    for (const [cx, cy] of [[w.x, w.y], [w.x + w.w, w.y], [w.x, w.y + w.h], [w.x + w.w, w.y + w.h]]) {
      const a = Math.atan2(cy - oy, cx - ox)
      angles.push(a - 0.0001, a, a + 0.0001)
    }
  }
  angles.sort((a, b) => a - b)
  for (const a of angles) {
    // 射线步进求交（墙 AABB 求交）
    const dx = Math.cos(a), dy = Math.sin(a)
    let best = radius
    for (const w of walls) {
      const t = rayAabb(ox, oy, dx, dy, w)
      if (t !== null && t < best) best = t
    }
    pts.push({ x: ox + dx * best, y: oy + dy * best })
  }
  return pts
}

// 射线 vs AABB，返回最近距离或 null
function rayAabb(ox, oy, dx, dy, w) {
  let tmin = -Infinity, tmax = Infinity
  if (Math.abs(dx) < 1e-9) {
    if (ox < w.x || ox > w.x + w.w) return null
  } else {
    let t1 = (w.x - ox) / dx, t2 = (w.x + w.w - ox) / dx
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < w.y || oy > w.y + w.h) return null
  } else {
    let t1 = (w.y - oy) / dy, t2 = (w.y + w.h - oy) / dy
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
  }
  if (tmax < 0 || tmin > tmax) return null
  return tmin > 0 ? tmin : null
}

// 房间探索状态管理：进入过的房间标记 explored（记忆迷雾用）
export function updateExplored(game) {
  const p = game.player
  for (const r of game.map.rooms) {
    if (r.explored) continue
    if (p.x > r.x - 30 && p.x < r.x + r.w + 30 && p.y > r.y - 30 && p.y < r.y + r.h + 30) {
      r.explored = true
      if (r.type !== 'corridor') {
        game.floats.push({ x: r.cx, y: r.y - 10, txt: '【' + (game.roomName(r)) + '】', t: 2, color: '#67e8f9', big: true })
      }
    }
  }
}
