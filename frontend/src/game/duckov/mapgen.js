/* ============================================================
 * 逃离鹅科夫 · 程序化地图生成器
 * 生成：房间网格 + 走廊连接 + 房间类型 + 门洞 + 掩体布置
 * 输出纯数据（无渲染依赖），与 Game/Renderer 解耦
 * ============================================================ */

// 房间类型定义：价值/敌人密度/特殊规则
export const ROOM_TYPES = {
  server: { name: '机房', value: 1, enemies: 2, color: '#164e63' },
  power: { name: '配电室', value: 2, enemies: 3, color: '#713f12' },
  cooling: { name: '冷却室', value: 2, enemies: 2, color: '#155e75', slow: 0.7 },
  archive: { name: '档案室', value: 1, enemies: 1, color: '#3f3f46' },
  vault: { name: '金库', value: 3, enemies: 4, color: '#4c1d95', vault: true },
  exit: { name: '撤离室', value: 0, enemies: 0, color: '#14532d', exit: true }
}

const rand = (a, b) => a + Math.random() * (b - a)
const randi = (a, b) => Math.floor(rand(a, b + 1))

// 生成一张地图：房间网格布局 + 走廊 + 掩体 + 物资点 + 敌人配置
export function generateMap(opts = {}) {
  const roomCount = opts.roomCount || randi(8, 11)
  const map = {
    rooms: [], corridors: [], walls: [], props: [],
    lootSpots: [], spawns: [], exits: [],
    playerSpawn: null, W: 0, H: 0
  }

  // ---- 1. 房间布局：网格槽位随机放置，保证相邻连通 ----
  const GRID = Math.ceil(Math.sqrt(roomCount * 1.6))
  const CELL = 520, PAD = 90
  const slots = []
  for (let gx = 0; gx < GRID; gx++) for (let gy = 0; gy < GRID; gy++) slots.push({ gx, gy })
  for (let i = slots.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = slots[i]; slots[i] = slots[j]; slots[j] = t }

  const used = new Set()
  let placed = 0
  for (const s of slots) {
    if (placed >= roomCount) break
    const key = s.gx + ',' + s.gy
    if (used.has(key)) continue
    if (placed > 0 && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(d => used.has((s.gx + d[0]) + ',' + (s.gy + d[1])))) continue
    used.add(key)
    const w = rand(300, 440), h = rand(260, 380)
    map.rooms.push({
      id: placed, gx: s.gx, gy: s.gy,
      x: s.gx * CELL + PAD, y: s.gy * CELL + PAD, w, h,
      cx: s.gx * CELL + PAD + w / 2, cy: s.gy * CELL + PAD + h / 2,
      doors: [], type: 'server'
    })
    placed++
  }

  // ---- 2. 房间类型分配 ----
  const sorted = [...map.rooms].sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy))
  const spawnRoom = sorted[0]
  spawnRoom.type = 'archive'
  map.playerSpawn = { x: spawnRoom.cx, y: spawnRoom.cy }
  const far = sorted.slice(-2)
  far.forEach(r => { r.type = 'exit' })
  const mid = sorted.filter(r => r !== spawnRoom && !far.includes(r))
  const vaultRoom = mid[mid.length - 1] || sorted[sorted.length - 3] || spawnRoom
  vaultRoom.type = 'vault'
  for (const r of map.rooms) {
    if (r.type !== 'archive' && r.type !== 'exit' && r.type !== 'vault') {
      r.type = ['server', 'server', 'power', 'cooling'][randi(0, 3)]
    }
  }

  // ---- 3. 走廊连接：最小生成树 + 2 条额外环路 ----
  const edges = []
  for (let i = 0; i < map.rooms.length; i++) {
    for (let j = i + 1; j < map.rooms.length; j++) {
      edges.push({ i, j, d: Math.hypot(map.rooms[i].cx - map.rooms[j].cx, map.rooms[i].cy - map.rooms[j].cy) })
    }
  }
  edges.sort((a, b) => a.d - b.d)
  const parent = map.rooms.map((_, i) => i)
  const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]))
  const linked = new Set()
  for (const e of edges) {
    const ra = find(e.i), rb = find(e.j)
    if (ra !== rb) { parent[ra] = rb; linked.add(e.i + '-' + e.j) }
  }
  let extra = 0
  for (const e of edges) {
    if (extra >= 2) break
    const k = e.i + '-' + e.j
    if (!linked.has(k)) { linked.add(k); extra++ }
  }

  for (const k of linked) {
    const parts = k.split('-')
    const a = map.rooms[+parts[0]], b = map.rooms[+parts[1]]
    const CW = 70
    const horizFirst = Math.random() < 0.5
    const segs = []
    if (horizFirst) {
      segs.push({ x: Math.min(a.cx, b.cx), y: a.cy - CW / 2, w: Math.abs(b.cx - a.cx), h: CW })
      segs.push({ x: b.cx - CW / 2, y: Math.min(a.cy, b.cy), w: CW, h: Math.abs(b.cy - a.cy) })
    } else {
      segs.push({ x: a.cx - CW / 2, y: Math.min(a.cy, b.cy), w: CW, h: Math.abs(b.cy - a.cy) })
      segs.push({ x: Math.min(a.cx, b.cx), y: b.cy - CW / 2, w: Math.abs(b.cx - a.cx), h: CW })
    }
    for (const s of segs) if (s.w > 4 && s.h > 4) map.corridors.push(s)
    // 门洞位置：走廊与房间墙的交点
    if (horizFirst) {
      a.doors.push({ dir: 'v', x: b.cx > a.cx ? a.x + a.w : a.x, y: a.cy })
      b.doors.push({ dir: 'v', x: a.cx > b.cx ? b.x + b.w : b.x, y: b.cy })
    } else {
      a.doors.push({ dir: 'h', x: a.cx, y: b.cy > a.cy ? a.y + a.h : a.y })
      b.doors.push({ dir: 'h', x: b.cx, y: a.cy > b.cy ? b.y + b.h : b.y })
    }
  }

  // ---- 4. 墙体生成：房间外墙 + 走廊墙，门洞挖空 ----
  const T = 14
  const wallRects = []
  const addWall = (x, y, w, h) => { if (w > 2 && h > 2) wallRects.push({ x, y, w, h }) }
  for (const r of map.rooms) {
    addWall(r.x - T, r.y - T, r.w + T * 2, T)
    addWall(r.x - T, r.y + r.h, r.w + T * 2, T)
    addWall(r.x - T, r.y, T, r.h)
    addWall(r.x + r.w, r.y, T, r.h)
  }
  for (const c of map.corridors) {
    addWall(c.x - T, c.y - T, c.w + T * 2, T)
    addWall(c.x - T, c.y + c.h, c.w + T * 2, T)
    addWall(c.x - T, c.y, T, c.h)
    addWall(c.x + c.w, c.y, T, c.h)
  }
  // 门洞挖空：在墙上开 100 宽的口（相交墙切分为残段）
  const carve = (dx, dy, dw, dh) => {
    for (let i = wallRects.length - 1; i >= 0; i--) {
      const w = wallRects[i]
      if (w.x < dx + dw && w.x + w.w > dx && w.y < dy + dh && w.y + w.h > dy) {
        wallRects.splice(i, 1)
        if (w.x < dx) wallRects.push({ x: w.x, y: w.y, w: dx - w.x, h: w.h })
        if (w.x + w.w > dx + dw) wallRects.push({ x: dx + dw, y: w.y, w: w.x + w.w - dx - dw, h: w.h })
        if (w.y < dy) wallRects.push({ x: Math.max(w.x, dx), y: w.y, w: Math.min(w.x + w.w, dx + dw) - Math.max(w.x, dx), h: dy - w.y })
        if (w.y + w.h > dy + dh) wallRects.push({ x: Math.max(w.x, dx), y: dy + dh, w: Math.min(w.x + w.w, dx + dw) - Math.max(w.x, dx), h: w.y + w.h - dy - dh })
      }
    }
  }
  for (const r of map.rooms) {
    for (const d of r.doors) {
      if (d.dir === 'h') carve(d.x - 50, d.y - 55, 100, 110)
      else carve(d.x - 55, d.y - 50, 110, 100)
    }
  }
  map.walls = wallRects

  // ---- 5. 房间内掩体 + 物资点 + 敌人 ----
  for (const r of map.rooms) {
    const t = ROOM_TYPES[r.type]
    const nCover = randi(2, 4)
    for (let i = 0; i < nCover; i++) {
      const horiz = Math.random() < 0.5
      const kind = Math.random() < 0.65 ? 'metal' : 'wood'
      map.props.push({
        x: rand(r.x + 50, r.x + r.w - 50), y: rand(r.y + 50, r.y + r.h - 50),
        w: horiz ? rand(60, 110) : rand(28, 40), h: horiz ? rand(28, 40) : rand(60, 110),
        kind, hp: kind === 'wood' ? 60 : Infinity, room: r.id
      })
    }
    if (!t.exit) {
      const nLoot = 1 + t.value + randi(0, 1)
      for (let i = 0; i < nLoot; i++) {
        map.lootSpots.push({
          x: rand(r.x + 40, r.x + r.w - 40), y: rand(r.y + 40, r.y + r.h - 40),
          room: r.id, tier: Math.min(3, t.value + (Math.random() < 0.25 ? 1 : 0)),
          opened: false
        })
      }
    }
    if (t.enemies > 0) {
      for (let i = 0; i < t.enemies; i++) {
        const kinds = r.type === 'vault' ? ['guard', 'guard', 'elite'] : r.type === 'power' ? ['guard', 'patrol'] : ['patrol', 'patrol', 'guard']
        map.spawns.push({
          x: rand(r.x + 40, r.x + r.w - 40), y: rand(r.y + 40, r.y + r.h - 40),
          room: r.id, kind: kinds[i % kinds.length]
        })
      }
      if (r.type === 'vault') map.spawns.push({ x: r.cx, y: r.cy, room: r.id, kind: 'boss' })
    }
    if (t.exit) {
      map.exits.push({ x: r.cx, y: r.cy, room: r.id, needKey: map.exits.length === 1, progress: 0 })
    }
  }
  map.W = GRID * CELL + PAD * 2
  map.H = GRID * CELL + PAD * 2
  return map
}

// 点所在房间（含走廊，走廊返回伪房间）
export function roomAt(map, x, y) {
  for (const r of map.rooms) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r
  }
  for (const c of map.corridors) {
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return { id: -1, type: 'corridor', x: c.x, y: c.y, w: c.w, h: c.h, cx: c.x + c.w / 2, cy: c.y + c.h / 2 }
  }
  return null
}
