/* ============================================================
 * 逃离鹅科夫 · 渲染器
 * 独立渲染模块：相机跟随 / 房间地面 / 墙体 / 掩体 / 物资发光分级
 * 敌人视野锥 / 战争迷雾 / 噪音圈 / 撤离光柱 / 断电演出
 * 只读 game 状态，不修改游戏逻辑
 * ============================================================ */
import { ROOM_TYPES } from './mapgen.js'

const TAU = Math.PI * 2

export function render(ctx, game) {
  const W = game.canvas.width
  const H = game.canvas.height
  const p = game.player
  ctx.save()
  ctx.fillStyle = '#05070d'
  ctx.fillRect(0, 0, W, H)
  if (!p) {
    ctx.restore()
    return
  }

  // 相机：跟随玩家 + 屏震
  let cx = p.x - W / 2, cy = p.y - H / 2
  if (game.shakeT > 0) {
    const s = 6 * game.shakeT / 0.15
    cx += (Math.random() - 0.5) * s
    cy += (Math.random() - 0.5) * s
  }
  ctx.save()
  ctx.translate(-cx, -cy)

  // ---- 房间地面 ----
  for (const r of game.map.rooms) {
    const t = ROOM_TYPES[r.type] || {}
    ctx.fillStyle = t.color || '#1e293b'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    // 地板网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    for (let gx = r.x; gx < r.x + r.w; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx, r.y); ctx.lineTo(gx, r.y + r.h); ctx.stroke()
    }
    for (let gy = r.y; gy < r.y + r.h; gy += 40) {
      ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke()
    }
    // 冷却室雾效
    if (r.type === 'cooling') {
      ctx.fillStyle = 'rgba(34,211,238,0.06)'
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    // 房间名（已探索才显示）
    if (r.explored) {
      ctx.fillStyle = 'rgba(103,232,249,0.35)'
      ctx.font = '11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText((t.name || '') + (r.type === 'vault' ? ' ⚠' : ''), r.cx, r.y + 16)
    }
  }
  // 走廊地面
  ctx.fillStyle = '#111827'
  for (const c of game.map.corridors) ctx.fillRect(c.x, c.y, c.w, c.h)

  // ---- 撤离点：绿色光柱 + 脉冲 ----
  for (const e of game.map.exits) {
    const locked = e.needKey && !game.hasKey
    const col = locked ? '#f59e0b' : '#4ade80'
    ctx.save()
    ctx.globalAlpha = 0.16 + 0.08 * Math.sin(game.time * 3)
    ctx.fillStyle = col
    ctx.fillRect(e.x - 26, e.y - 26, 52, 52)
    ctx.restore()
    ctx.strokeStyle = col
    ctx.lineWidth = 2
    ctx.setLineDash([6, 5])
    ctx.beginPath(); ctx.arc(e.x, e.y, 22 + Math.sin(game.time * 3) * 3, 0, TAU); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = col
    ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(locked ? 'EXIT 🔒需钥匙' : 'EXIT', e.x, e.y + 4)
  }

  // ---- 物资点：发光分级（白微光→金强光柱） ----
  for (const s of game.map.lootSpots) {
    if (s.opened) continue
    const tierCols = ['#e2e8f0', '#4ade80', '#60a5fa', '#fde047']
    const col = tierCols[s.tier] || '#e2e8f0'
    ctx.save()
    ctx.shadowColor = col
    ctx.shadowBlur = 6 + s.tier * 5
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(s.x - 9, s.y - 7, 18, 14)
    ctx.strokeStyle = col
    ctx.lineWidth = 1.5
    ctx.strokeRect(s.x - 9, s.y - 7, 18, 14)
    ctx.shadowBlur = 0
    ctx.fillStyle = col
    ctx.fillRect(s.x - 4, s.y - 3, 8, 6)
    ctx.restore()
  }

  // ---- 掩体 ----
  for (const pr of game.map.props) {
    if (pr.hp <= 0) continue
    ctx.fillStyle = pr.kind === 'metal' ? '#334155' : '#78350f'
    ctx.fillRect(pr.x, pr.y, pr.w, pr.h)
    ctx.strokeStyle = pr.kind === 'metal' ? '#64748b' : '#b45309'
    ctx.lineWidth = 1.5
    ctx.strokeRect(pr.x, pr.y, pr.w, pr.h)
    if (pr.kind === 'metal') {
      ctx.fillStyle = 'rgba(103,232,249,0.25)'
      for (let i = 1; i < 3; i++) {
        const fx = pr.x + pr.w * i / 3
        ctx.fillRect(fx - 1, pr.y + 3, 2, pr.h - 6)
      }
    }
  }

  // ---- 墙体 ----
  for (const w of game.map.walls) {
    ctx.fillStyle = '#1f2937'
    ctx.fillRect(w.x, w.y, w.w, w.h)
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 1
    ctx.strokeRect(w.x, w.y, w.w, w.h)
  }

  // ---- 噪音圈 ----
  for (const n of game.noiseRings) {
    ctx.globalAlpha = Math.max(0, n.t / 0.6) * 0.5
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU); ctx.stroke()
    ctx.globalAlpha = 1
  }

  // ---- 敌人 ----
  for (const e of game.enemies) {
    if (e.dead) continue
    // 仅当敌人本身在玩家视野内才绘制（视野锥不穿墙显示）
    if (game.fovPoly && inFov(game, e.x, e.y)) {
      ctx.save()
      ctx.translate(e.x, e.y)
      ctx.globalAlpha = 0.16
      ctx.fillStyle = e.state === 'combat' ? '#ef4444' : (e.state === 'patrol' ? '#f59e0b' : '#fbbf24')
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, e.d.sight, e.face - e.d.fov, e.face + e.d.fov)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = e.state === 'combat' ? '#fca5a5' : '#fcd34d'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
    }
    // 身体
    ctx.save()
    ctx.translate(e.x, e.y)
    ctx.shadowColor = e.d.color
    ctx.shadowBlur = e.d.boss ? 22 : (e.d.elite ? 14 : 7)
    ctx.strokeStyle = e.d.color
    ctx.lineWidth = 2
    ctx.fillStyle = e.d.color + '33'
    ctx.beginPath()
    if (e.d.boss) {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + game.time * 0.5
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
    } else {
      ctx.arc(0, 0, e.r, 0, TAU)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    if (e.flashT > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fill()
    }
    // 朝向玩家的眼睛
    const ea = Math.atan2(p.y - e.y, p.x - e.x)
    const ex = Math.cos(ea), ey = Math.sin(ea)
    for (let s = -1; s <= 1; s += 2) {
      const ox = ex * 2 - ey * s * e.r * 0.34
      const oy = ey * 2 + ex * s * e.r * 0.34
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(ox, oy, e.r * 0.24, 0, TAU); ctx.fill()
      ctx.fillStyle = '#111'
      ctx.beginPath(); ctx.arc(ox + ex * e.r * 0.09, oy + ey * e.r * 0.09, e.r * 0.12, 0, TAU); ctx.fill()
    }
    ctx.restore()
    // 状态标记 ? / !
    if (e.alertMarkT > 0) {
      ctx.fillStyle = e.alertMark === '!' ? '#ef4444' : '#fbbf24'
      ctx.font = 'bold 18px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(e.alertMark, e.x, e.y - e.r - 10)
    }
    // 血条（带数值）
    if (e.hp < e.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(e.x - e.r, e.y - e.r - 7, e.r * 2, 3)
      ctx.fillStyle = '#f87171'
      ctx.fillRect(e.x - e.r, e.y - e.r - 7, e.r * 2 * (e.hp / e.maxHp), 3)
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '9px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(Math.ceil(e.hp) + '/' + e.maxHp, e.x, e.y - e.r - 10)
    }
  }

  // ---- 敌方子弹 ----
  for (const b of game.ebullets) {
    ctx.save()
    ctx.shadowColor = b.color
    ctx.shadowBlur = 8
    ctx.fillStyle = b.color
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill()
    ctx.restore()
  }

  // ---- 玩家子弹 ----
  for (const b of game.bullets) {
    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.rotate(Math.atan2(b.vy, b.vx))
    ctx.shadowColor = b.color
    ctx.shadowBlur = 6
    ctx.fillStyle = b.color
    ctx.beginPath()
    ctx.moveTo(6, 0); ctx.lineTo(-4, -2.5); ctx.lineTo(-4, 2.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // ---- 玩家 ----
  ctx.save()
  ctx.translate(p.x, p.y)
  if (p.invuln > 0 && ((game.time * 20) | 0) % 2 === 0) ctx.globalAlpha = 0.4
  ctx.shadowColor = '#67e8f9'
  ctx.shadowBlur = 14
  ctx.fillStyle = '#0e7490'
  ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#22d3ee'
  ctx.beginPath(); ctx.arc(0, 0, p.r - 3, 0, TAU); ctx.fill()
  ctx.fillStyle = '#e0f2fe'
  ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill()
  ctx.rotate(p.face)
  ctx.fillStyle = '#164e63'
  ctx.strokeStyle = '#67e8f9'
  ctx.lineWidth = 1.5
  ctx.fillRect(p.r - 6, -3, 14, 6)
  ctx.strokeRect(p.r - 6, -3, 14, 6)
  ctx.restore()

  // ---- 粒子 ----
  for (const pt of game.particles) {
    ctx.globalAlpha = Math.max(0, pt.t / 0.4)
    ctx.fillStyle = pt.color
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size)
    ctx.globalAlpha = 1
  }

  // ---- 飘字 ----
  ctx.textAlign = 'center'
  for (const f of game.floats) {
    ctx.globalAlpha = Math.min(1, f.t / 0.3)
    ctx.fillStyle = f.color
    ctx.font = (f.big ? 'bold 16px' : '12px') + ' monospace'
    ctx.fillText(f.txt, f.x, f.y)
    ctx.globalAlpha = 1
  }

  ctx.restore() // 相机

  // ---- 战争迷雾：视野多边形外遮暗 ----
  if (game.fovPoly) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.translate(-cx, -cy)
    // 视野多边形作为挖空区域
    ctx.moveTo(game.fovPoly[0].x, game.fovPoly[0].y)
    for (let i = 1; i < game.fovPoly.length; i++) ctx.lineTo(game.fovPoly[i].x, game.fovPoly[i].y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(2,4,10,0.88)'
    ctx.fill('evenodd')
    ctx.restore()
  }

  // ---- 断电演出：全屏黑暗收缩 ----
  if (game.blackout > 0) {
    ctx.save()
    const k = Math.min(1, game.blackout / 10)
    ctx.fillStyle = 'rgba(0,0,0,' + (0.75 * k).toFixed(2) + ')'
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.arc(W / 2, H / 2, 150, 0, TAU, true)
    ctx.fill()
    ctx.restore()
  }

  // ---- 撤离倒计时最后 10s：红色警报脉冲 ----
  if (game.exitT < 10) {
    const a = 0.12 + 0.1 * Math.abs(Math.sin(game.time * 6))
    ctx.fillStyle = 'rgba(239,68,68,' + a.toFixed(3) + ')'
    ctx.fillRect(0, 0, W, H)
  }

  // ---- 受击红闪 ----
  if (game.flash > 0) {
    ctx.fillStyle = 'rgba(239,68,68,' + (Math.min(0.5, game.flash) * 0.6).toFixed(3) + ')'
    ctx.fillRect(0, 0, W, H)
  }

  // ---- CRT 扫描线 ----
  ctx.globalAlpha = 0.05
  ctx.fillStyle = '#000'
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2)
  ctx.globalAlpha = 1

  // ---- 交互提示 ----
  if (game.openTarget) {
    const s = game.openTarget
    const sx = s.x - cx, sy = s.y - cy
    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('按住 E 搜刮', sx, sy - 24)
    // 开箱进度条
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(sx - 20, sy - 20, 40, 5)
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(sx - 20, sy - 20, 40 * Math.min(1, game.openT / 1.2), 5)
  }
  if (game.exitTarget) {
    const e = game.exitTarget
    const sx = e.x - cx, sy = e.y - cy
    ctx.fillStyle = '#4ade80'
    ctx.font = 'bold 12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('撤离中...', sx, sy - 34)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(sx - 26, sy - 30, 52, 5)
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(sx - 26, sy - 30, 52 * Math.min(1, game.exitProgress / 3), 5)
  }
  ctx.restore()
}

// 敌人是否在玩家视野多边形内（粗略：距离 + 无墙）
function inFov(game, x, y) {
  const p = game.player
  const d = Math.hypot(x - p.x, y - p.y)
  if (d > 280) return false
  return game.lineClear(p.x, p.y, x, y)
}
