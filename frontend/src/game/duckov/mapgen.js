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
  archive: { name: '档案室', value: 1, enemies: 0, color: '#3f3f46' },
  radiation: { name: '辐射室', value: 3, enemies: 2, color: '#7c2d12', radiation: true },
  armory: { name: '军械库', value: 2, enemies: 3, color: '#1e3a5f', armory: true },
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
    lootSpots: [], spawns: [], exits: [], healSpots: [],
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
    // 房间形状多样化：大/小/圆/L 形/T 形/矩形（L/T 用切角块构成，块计入墙体）
    const shapeRoll = Math.random()
    let w, h, shape = 'rect'
    const blocks = []
    if (shapeRoll < 0.14) { w = rand(380, 460); h = rand(360, 440); shape = 'big' }
    else if (shapeRoll < 0.28) { w = rand(220, 280); h = rand(200, 260); shape = 'small' }
    else if (shapeRoll < 0.40) { w = rand(320, 400); h = rand(320, 400); shape = 'round' }
    else if (shapeRoll < 0.56) {
      // L 形：切掉一个角
      w = rand(380, 480); h = rand(360, 440); shape = 'L'
      const bw = w * rand(0.32, 0.45), bh = h * rand(0.32, 0.45)
      const c = randi(0, 3)
      if (c === 0) blocks.push({ x: 0, y: 0, w: bw, h: bh })
      else if (c === 1) blocks.push({ x: w - bw, y: 0, w: bw, h: bh })
      else if (c === 2) blocks.push({ x: w - bw, y: h - bh, w: bw, h: bh })
      else blocks.push({ x: 0, y: h - bh, w: bw, h: bh })
    } else if (shapeRoll < 0.66) {
      // T 形：切掉同侧两个角
      w = rand(400, 500); h = rand(360, 430); shape = 'T'
      const bw = w * rand(0.26, 0.36), bh = h * rand(0.3, 0.4)
      blocks.push({ x: 0, y: 0, w: bw, h: bh })
      blocks.push({ x: w - bw, y: 0, w: bw, h: bh })
    } else { w = rand(300, 440); h = rand(260, 380) }
    const rx = s.gx * CELL + PAD, ry = s.gy * CELL + PAD
    map.rooms.push({
      id: placed, gx: s.gx, gy: s.gy,
      x: rx, y: ry, w, h,
      cx: rx + w / 2, cy: ry + h / 2,
      doors: [], type: 'server', shape,
      blocks: blocks.map(b => ({ x: rx + b.x, y: ry + b.y, w: b.w, h: b.h }))
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
      r.type = ['server', 'server', 'power', 'cooling', 'radiation', 'armory'][randi(0, 5)]
    }
  }
  // 主题分区：机房区（青）/ 仓储区（琥珀）/ 实验区（品红）
  const ZONE_OF = { server: 'tech', power: 'tech', cooling: 'tech', archive: 'storage', armory: 'storage', radiation: 'lab', vault: 'lab', exit: 'exit' }
  for (const r of map.rooms) r.zone = ZONE_OF[r.type] || 'tech'

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
  const extraSet = new Set()
  for (const e of edges) {
    if (extra >= 2) break
    const k = e.i + '-' + e.j
    if (!linked.has(k)) { linked.add(k); extraSet.add(k); extra++ }
  }

  for (const k of linked) {
    const parts = k.split('-')
    const a = map.rooms[+parts[0]], b = map.rooms[+parts[1]]
    // 主干走廊 92 宽 / 环路窄道 52 宽（伏击点）
    const CW = extraSet.has(k) ? 52 : 92
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
    // L/T 形房间：切角块作为实心墙体
    for (const b of (r.blocks || [])) addWall(b.x, b.y, b.w, b.h)
  }
  for (const c of map.corridors) {
    // 走廊不生成自身墙体：开放通道（避免走廊墙横穿房间困死出生点）
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
  // 门洞挖空：走廊矩形与每面房间墙条的相交处开门（修复原门位计算错误导致房间被封死）
  for (const c of map.corridors) {
    for (const r of map.rooms) {
      const strips = [
        { x: r.x - T, y: r.y - T, w: r.w + T * 2, h: T, horiz: true },
        { x: r.x - T, y: r.y + r.h, w: r.w + T * 2, h: T, horiz: true },
        { x: r.x - T, y: r.y, w: T, h: r.h, horiz: false },
        { x: r.x + r.w, y: r.y, w: T, h: r.h, horiz: false }
      ]
      for (const s of strips) {
        const ox = Math.max(c.x, s.x), oy = Math.max(c.y, s.y)
        const ox2 = Math.min(c.x + c.w, s.x + s.w), oy2 = Math.min(c.y + c.h, s.y + s.h)
        if (ox2 - ox <= 6 || oy2 - oy <= 6) continue
        // 平行擦边保护：切向长度超 120 时截断为中心 120 段，避免整面墙被掀开
        let cx0 = ox, cy0 = oy, cw = ox2 - ox, ch = oy2 - oy
        if (s.horiz && cw > 120) { cx0 = (ox + ox2) / 2 - 60; cw = 120 }
        if (!s.horiz && ch > 120) { cy0 = (oy + oy2) / 2 - 60; ch = 120 }
        carve(cx0, cy0, cw, ch)
      }
    }
  }
  map.walls = wallRects

  // L/T 形房间：切角块附近不可放置掩体/物资/敌人/急救站
  const inBlock = (r, x, y, m = 34) => (r.blocks || []).some(b => x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m)
  const randInRoom = (r, m) => {
    for (let t = 0; t < 14; t++) {
      const x = rand(r.x + m, r.x + r.w - m), y = rand(r.y + m, r.y + r.h - m)
      if (!inBlock(r, x, y)) return { x, y }
    }
    return { x: r.cx, y: r.cy }
  }

  // ---- 5. 房间内掩体 + 物资点 + 敌人 ----
  for (const r of map.rooms) {
    const t = ROOM_TYPES[r.type]
    // 内部陈设按房间类型差异化
    let nCover = randi(2, 4)
    let coverKind = 'mixed'
    if (r.type === 'armory') { nCover = randi(4, 6); coverKind = 'crate' }
    else if (r.type === 'radiation') { nCover = randi(1, 2); coverKind = 'barrel' }
    else if (r.type === 'vault') { nCover = randi(3, 5); coverKind = 'metal' }
    else if (r.type === 'archive') { nCover = randi(3, 5); coverKind = 'wood' }
    else if (r.type === 'server') { nCover = randi(3, 5); coverKind = 'rack' }
    for (let i = 0; i < nCover; i++) {
      const horiz = Math.random() < 0.5
      let kind
      if (coverKind === 'mixed') kind = Math.random() < 0.65 ? 'metal' : 'wood'
      else if (coverKind === 'crate') kind = 'crate'
      else if (coverKind === 'barrel') kind = 'barrel'
      else if (coverKind === 'rack') kind = 'rack'
      else kind = coverKind
      const isBarrel = kind === 'barrel'
      const isCrate = kind === 'crate'
      const isRack = kind === 'rack'
      const pp = randInRoom(r, 50)
      map.props.push({
        x: pp.x, y: pp.y,
        w: isBarrel ? rand(26, 34) : (isCrate ? rand(44, 60) : (isRack ? (horiz ? rand(70, 120) : rand(30, 42)) : (horiz ? rand(60, 110) : rand(28, 40)))),
        h: isBarrel ? rand(26, 34) : (isCrate ? rand(44, 60) : (isRack ? (horiz ? rand(30, 42) : rand(70, 120)) : (horiz ? rand(28, 40) : rand(60, 110)))),
        kind, hp: (kind === 'wood' || kind === 'crate' || kind === 'barrel') ? 60 : Infinity, room: r.id
      })
    }
    if (!t.exit) {
      const nLoot = 1 + t.value + randi(0, 1)
      for (let i = 0; i < nLoot; i++) {
        const lp = randInRoom(r, 40)
        map.lootSpots.push({
          x: lp.x, y: lp.y,
          room: r.id, tier: Math.min(3, t.value + (Math.random() < 0.25 ? 1 : 0)),
          opened: false
        })
      }
    }
    if (t.enemies > 0) {
      for (let i = 0; i < t.enemies; i++) {
        const kinds = r.type === 'vault' ? ['guard', 'guard', 'elite', 'sniper'] : r.type === 'power' ? ['guard', 'patrol', 'sniper'] : r.type === 'cooling' ? ['patrol', 'drone'] : r.type === 'radiation' ? ['bomber', 'bomber', 'rusher'] : r.type === 'armory' ? ['guard', 'rusher', 'sniper'] : ['patrol', 'patrol', 'guard', 'drone', 'rusher', 'bomber']
        const sp = randInRoom(r, 40)
        map.spawns.push({
          x: sp.x, y: sp.y,
          room: r.id, kind: kinds[i % kinds.length]
        })
      }
      if (r.type === 'vault') map.spawns.push({ x: r.cx, y: r.cy, room: r.id, kind: 'boss' })
    }
    if (t.exit) {
      // 撤离点多样化：第一个为钥匙门（安全但需钥匙），第二个为快速通道（无需钥匙但撤离读条仅 1.5s，位置更深入）
      const first = map.exits.length === 0
      const ep = first ? { x: r.cx, y: r.cy } : randInRoom(r, 60)
      map.exits.push({
        x: ep.x, y: ep.y,
        room: r.id,
        needKey: first,
        mode: first ? 'normal' : 'express',
        progress: 0
      })
    }
  }
  // ---- 5.5 敌人密度归一化：总数收敛到 12~16，避免 5~23 的极端方差 ----
  const targetEnemies = randi(12, 16)
  const spawnableRooms = map.rooms.filter(r => r.type !== 'exit' && r.type !== 'archive')
  const poolKinds = ['patrol', 'guard', 'drone', 'rusher', 'sniper']
  while (map.spawns.length < targetEnemies && spawnableRooms.length) {
    const r = spawnableRooms[(Math.random() * spawnableRooms.length) | 0]
    const sp = randInRoom(r, 40)
    map.spawns.push({ x: sp.x, y: sp.y, room: r.id, kind: poolKinds[(Math.random() * poolKinds.length) | 0] })
  }
  if (map.spawns.length > targetEnemies + 2) {
    const bosses = map.spawns.filter(s => s.kind === 'boss')
    const others = map.spawns.filter(s => s.kind !== 'boss').slice(0, Math.max(0, targetEnemies + 2 - bosses.length))
    map.spawns = [...others, ...bosses]
  }

  // ---- 6. 急救站：少量回血道具点（路过自动拾取 +30 HP，满血不消耗）----
  const healRooms = map.rooms.filter(r => r.type !== 'exit' && r.type !== 'archive')
  const nHeal = Math.min(healRooms.length, randi(3, 4))
  for (let i = 0; i < nHeal; i++) {
    const r = healRooms[(Math.random() * healRooms.length) | 0]
    const hpt = randInRoom(r, 50)
    map.healSpots.push({
      x: hpt.x, y: hpt.y,
      room: r.id, taken: false
    })
  }
  // ---- 7. 可达性校验：撤离点/物资点必须能从出生点走到（BFS 网格泛洪）----
  const CS = 24
  const MW = GRID * CELL + PAD * 2
  const mcols = Math.ceil(MW / CS), mrows = Math.ceil(MW / CS)
  const solidAt = (x, y) => {
    for (const w of map.walls) if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) return true
    for (const pr of map.props) if (x > pr.x && x < pr.x + pr.w && y > pr.y && y < pr.y + pr.h) return true
    return false
  }
  const cellBlocked = (i, j) => i < 0 || j < 0 || i >= mcols || j >= mrows || solidAt(i * CS + CS / 2, j * CS + CS / 2)
  // BFS 起点：出生点所在格（被掩体占住时向外螺旋找最近空格）
  let s0 = null
  outerSpawn: for (let rr = 0; rr <= 6; rr++) {
    for (let di = -rr; di <= rr; di++) for (let dj = -rr; dj <= rr; dj++) {
      const i = Math.floor(map.playerSpawn.x / CS) + di
      const j = Math.floor(map.playerSpawn.y / CS) + dj
      if (!cellBlocked(i, j)) { s0 = [i, j]; break outerSpawn }
    }
  }
  if (s0) {
    const reach = new Uint8Array(mcols * mrows)
    reach[s0[1] * mcols + s0[0]] = 1
    const qq = [s0]
    while (qq.length) {
      const [ci, cj] = qq.shift()
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + d[0], nj = cj + d[1]
        if (cellBlocked(ni, nj) || reach[nj * mcols + ni]) continue
        reach[nj * mcols + ni] = 1
        qq.push([ni, nj])
      }
    }
    const reachable = (x, y) => {
      const i = Math.floor(x / CS), j = Math.floor(y / CS)
      return i >= 0 && j >= 0 && i < mcols && j < mrows && reach[j * mcols + i] === 1
    }
    // 不可达的点在所属房间内螺旋采样换位；房间整体不可达则清掉中心掩体兜底
    const fixSpot = (s) => {
      if (reachable(s.x, s.y)) return
      const r = map.rooms.find(rr2 => rr2.id === s.room) || map.rooms[0]
      for (let m = 30; m <= 150; m += 18) {
        for (let t = 0; t < 24; t++) {
          const x = r.cx + Math.cos(t / 24 * Math.PI * 2) * m
          const y = r.cy + Math.sin(t / 24 * Math.PI * 2) * m
          if (x > r.x + 20 && x < r.x + r.w - 20 && y > r.y + 20 && y < r.y + r.h - 20 && reachable(x, y)) {
            s.x = x; s.y = y
            return
          }
        }
      }
      s.x = r.cx; s.y = r.cy
      map.props = map.props.filter(pr => !(pr.x < r.cx + 30 && pr.x + pr.w > r.cx - 30 && pr.y < r.cy + 30 && pr.y + pr.h > r.cy - 30))
    }
    for (const e of map.exits) fixSpot(e)
    for (const s of map.lootSpots) fixSpot(s)
  }

  map.W = GRID * CELL + PAD * 2
  map.H = GRID * CELL + PAD * 2
  return map
}

// 点所在房间（含走廊，走廊返回伪房间）
export function roomAt(map, x, y) {
  for (const r of map.rooms) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      // L/T 形房间：切角块区域不算房间内部
      if ((r.blocks || []).some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) continue
      return r
    }
  }
  for (const c of map.corridors) {
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return { id: -1, type: 'corridor', x: c.x, y: c.y, w: c.w, h: c.h, cx: c.x + c.w / 2, cy: c.y + c.h / 2 }
  }
  return null
}
