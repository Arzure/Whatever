<script setup>
// 逐夜行动关系图：人物为节点（含真实身份），行动为带箭头连线，每夜一张
import { ref, computed } from 'vue';

const props = defineProps({
  log: { type: Object, required: true },
  roles: { type: Array, default: () => [] },
});

// 阵营配色（节点边框与身份文字）
const CAMP_COLOR = { good: '#58a6ff', neutral: '#d29922', evil: '#f85149' };
const ROLE_CAMP = {
  文员: 'good', 侦探: 'good', 村民: 'good', 法医: 'good', 守卫: 'good', 观者: 'good', 邮差: 'good', 行者: 'good',
  赌徒: 'neutral', 小偷: 'neutral', 庸医: 'neutral', 间谍: 'neutral',
  狼人: 'evil', 帮凶: 'evil', 酒鬼: 'evil', 小丑: 'evil', 术士: 'evil',
};
// 行为类型配色（连线与标注）
const EDGE_COLOR = {
  kill: '#f85149', protect: '#3fb950', probe: '#58a6ff', visit: '#d29922',
  steal: '#a371f7', gamble: '#db61a2', confuse: '#ff7b72', link: '#39c5cf',
};

function buildEdges(l) {
  const e = [];
  if (l.wolf) e.push({ from: l.wolf.who, to: l.wolf.target, label: l.wolf.blocked ? '袭击·被挡' : '刀杀', type: 'kill' });
  if (l.guard) e.push({ from: l.guard.who, to: l.guard.target, label: '保护', type: 'protect' });
  if (l.detective) e.push({ from: l.detective.who, to: l.detective.target, label: `探访·${l.detective.clue}`, type: 'probe' });
  if (l.accomplice) e.push({ from: l.accomplice.who, to: l.accomplice.target, label: '拜访', type: 'visit' });
  if (l.thief) e.push({ from: l.thief.who, to: l.thief.target, label: '窃密', type: 'steal' });
  if (l.gambler) e.push({ from: l.gambler.who, to: l.gambler.target, label: `猜·${l.gambler.claim}${l.gambler.died ? '·殒命' : ''}`, type: 'gamble' });
  if (l.forensics && l.forensics.target) e.push({ from: l.forensics.who, to: l.forensics.target, label: `验尸·${l.forensics.role || '?'}`, type: 'probe' });
  if (l.watcher) e.push({ from: l.watcher.who, to: l.watcher.target, label: `观测·${l.watcher.camp}`, type: 'probe' });
  if (l.postman) e.push({ from: l.postman.who, to: l.postman.target, label: l.postman.saved ? '送信·挡刀' : '送信', type: 'visit' });
  if (l.walker) e.push({ from: l.walker.who, to: l.walker.target, label: l.walker.kill ? '同归于尽' : '探明身份', type: l.walker.kill ? 'kill' : 'probe' });
  if (l.spy) e.push({ from: l.spy.who, to: l.spy.target, label: l.spy.lie ? '刺探·将撒谎' : '刺探', type: 'probe' });
  if (l.clown) e.push({ from: l.clown.who, to: l.clown.target, label: '扭曲记忆', type: 'confuse' });
  if (l.warlock && l.warlock.links && l.warlock.links.length === 2) {
    // 术士才是执行者：从他出发连向两位被链接者；另加一条虚线标出两人的命运关联
    e.push({ from: l.warlock.who, to: l.warlock.links[0], label: '链接命运', type: 'link' });
    e.push({ from: l.warlock.who, to: l.warlock.links[1], label: '链接命运', type: 'link' });
  }
  if (l.drunkard) (l.drunkard.affected || []).forEach((n) => e.push({ from: l.drunkard.who, to: n, label: '迷醉', type: 'confuse' }));
  if (l.quack) {
    (l.quack.saves || []).forEach((n) => e.push({ from: l.quack.who, to: n, label: '救治', type: 'protect' }));
    (l.quack.poisons || []).forEach((n) => e.push({ from: l.quack.who, to: n, label: '毒杀', type: 'kill' }));
  }
  return e;
}

// 二次贝塞尔曲线上的点
function quadPoint(p0, c, p1, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

// 人物框尺寸（半宽/半高）与连线避让间距
const NODE_HW = 50, NODE_HH = 27, EDGE_PAD = 9;
/**
 * 求『从 from 中心射向 to 中心』的射线与 from 人物框（外扩 EDGE_PAD）的交点。
 * 连线起止点都用它计算，即可让线条与箭头都落在框外，不被遮挡。
 */
function boxEdgePoint(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx && !dy) return { x: from.x, y: from.y };
  const hw = NODE_HW + EDGE_PAD, hh = NODE_HH + EDGE_PAD;
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const k = Math.min(tx, ty); // 取先碰到的那条边
  return { x: from.x + dx * k, y: from.y + dy * k };
}

const graph = computed(() => {
  const l = props.log;
  const edges = buildEdges(l);
  const deaths = new Set(l.deaths || []);
  const names = [];
  const addName = (n) => { if (n && !names.includes(n)) names.push(n); };
  edges.forEach((e) => { addName(e.from); addName(e.to); });
  if (l.warlock) (l.warlock.chain || []).forEach(addName);
  deaths.forEach(addName);

  const W = 860, H = 640, cx = W / 2, cy = H / 2;
  const R = names.length <= 4 ? 150 : 240;
  const nodes = names.map((name, i) => {
    const ang = (i / Math.max(names.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const role = props.roles.find((r) => r.name === name);
    return {
      name,
      x: cx + R * Math.cos(ang),
      y: cy + R * Math.sin(ang),
      role: role ? (role.roleBackup ? `${role.roleBackup}→${role.role}` : role.role) : '身份不明',
      camp: role ? ROLE_CAMP[role.role] || '' : '',
      dead: deaths.has(name),
    };
  });
  const pos = new Map(nodes.map((n) => [n.name, n]));

  const geo = edges.map((e, i) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return null;
    const color = EDGE_COLOR[e.type] || '#8b949e';
    if (a === b) {
      // 自环（如守卫自保）：在节点上方画一个小弧（起止点贴在框顶外缘）
      const path = `M ${a.x - 16} ${a.y - NODE_HH - EDGE_PAD} C ${a.x - 44} ${a.y - 78}, ${a.x + 44} ${a.y - 78}, ${a.x + 16} ${a.y - NODE_HH - EDGE_PAD}`;
      return { ...e, path, lx: a.x, ly: a.y - 72, color, order: i };
    }
    // 控制点：以两框中心连线的『垂直方向』偏移形成弧度（A→B 与 B→A 的垂线方向天然相反，两条线分居两侧）。
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ndx = b.x - a.x, ndy = b.y - a.y;
    const nlen = Math.hypot(ndx, ndy) || 1;
    const nx = -ndy / nlen, ny = ndx / nlen; // 连线的垂线单位向量
    const baseBend = Math.min(nlen * 0.16, 80); // 弧度随距离自适应，封顶避免过大
    // 避让中间人物：曲线不得穿过连线双方之外的第三方人物框（修复『保护线穿过周舟』类问题）。
    // 候选方案：正/反两侧 × 逐级加大弧度；采样贝塞尔曲线检测碰撞，取首个无碰撞方案；
    // 全部碰撞时保留碰撞人数最少的方案（尽力避让）。
    const others = nodes.filter((n) => n !== a && n !== b);
    const hitCount = (ctrl) => {
      const s0 = boxEdgePoint(a, ctrl), t0 = boxEdgePoint(b, ctrl);
      let cnt = 0;
      for (const n of others) {
        const hw = NODE_HW + EDGE_PAD, hh = NODE_HH + EDGE_PAD;
        for (let k = 1; k < 12; k++) {
          const p = quadPoint(s0, ctrl, t0, k / 12);
          if (Math.abs(p.x - n.x) <= hw && Math.abs(p.y - n.y) <= hh) { cnt++; break; }
        }
      }
      return cnt;
    };
    let c = { x: mx + nx * baseBend, y: my + ny * baseBend };
    let bestHits = others.length ? hitCount(c) : 0;
    if (bestHits > 0) {
      const cands = [];
      for (const dir of [1, -1]) {
        for (const mul of [1, 1.8, 2.6, 3.4]) {
          cands.push({ x: mx + nx * dir * baseBend * mul, y: my + ny * dir * baseBend * mul });
        }
      }
      for (const cand of cands) {
        const h = hitCount(cand);
        if (h < bestHits) { bestHits = h; c = cand; }
        if (bestHits === 0) break;
      }
    }
    // 起止点：沿『中心→控制点』方向与人物框边缘求交（避免线条压在框上）
    const s = boxEdgePoint(a, c);
    const t = boxEdgePoint(b, c);
    const mid = quadPoint(s, c, t, 0.5);
    return { ...e, path: `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${t.x} ${t.y}`, lx: mid.x, ly: mid.y, color, order: i };
  }).filter(Boolean);

  return { W, H, nodes, edges: geo };
});

function campColor(n) { return CAMP_COLOR[n.camp] || '#8b949e'; }

// —— 交互：悬停高亮连线 / 点击展开人物当夜行动详情 ——
const hoverName = ref('');
const activeName = ref('');
function nodeEdges(n) {
  // 该人物相关的所有连线（作为执行者或目标）
  return graph.value.edges.filter((e) => e.from === n.name || e.to === n.name);
}
function isEdgeDim(e) {
  if (!hoverName.value && !activeName.value) return false;
  const focus = hoverName.value || activeName.value;
  return e.from !== focus && e.to !== focus;
}
// 人物当夜行动详情（执行的行动 + 被指向的行动）
const activeDetail = computed(() => {
  if (!activeName.value) return null;
  const g = graph.value;
  const node = g.nodes.find((n) => n.name === activeName.value);
  if (!node) return null;
  const outgoing = g.edges.filter((e) => e.from === activeName.value);
  const incoming = g.edges.filter((e) => e.to === activeName.value && e.from !== activeName.value);
  return { node, outgoing, incoming };
});
</script>

<template>
  <svg :viewBox="`0 0 ${graph.W} ${graph.H}`" class="night-graph" role="img" :aria-label="`第${log.round}夜行动关系图`">
    <defs>
      <marker v-for="(color, type) in EDGE_COLOR" :id="`ng-arrow-${log.round}-${type}`" :key="type"
        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" :fill="color" />
      </marker>
    </defs>
    <path v-for="(e, i) in graph.edges" :key="'e' + i" :d="e.path" :stroke="e.color" :stroke-width="e.dashed ? 1.5 : 2" fill="none"
      pathLength="1"
      class="edge-line" :style="{ animationDelay: (0.3 + e.order * 0.38) + 's' }"
      :class="{ 'edge-dim': isEdgeDim(e), 'edge-dashed': e.dashed }"
      :marker-end="`url(#ng-arrow-${log.round}-${e.type})`" />
    <text v-for="(e, i) in graph.edges" :key="'l' + i" :x="e.lx" :y="e.ly" class="edge-label" :fill="e.color"
      :style="{ animationDelay: (0.55 + e.order * 0.38) + 's' }"
      :class="{ 'edge-dim': isEdgeDim(e) }">{{ e.label }}</text>
    <g v-for="(n, i) in graph.nodes" :key="n.name" :transform="`translate(${n.x},${n.y})`"
      class="node-g"
      @mouseenter="hoverName = n.name" @mouseleave="hoverName = ''"
      @click="activeName = activeName === n.name ? '' : n.name">
      <g class="node-inner" :style="{ animationDelay: (i * 0.12) + 's' }">
      <rect x="-50" y="-27" width="100" height="54" rx="9" class="node-box" :stroke="campColor(n)" stroke-width="2"
        :class="{ 'node-active': activeName === n.name || hoverName === n.name }" />
      <text y="-3" class="node-name">{{ n.name }}</text>
      <text y="17" class="node-role" :fill="campColor(n)">{{ n.role }}{{ n.dead ? ' 💀' : '' }}</text>
      </g>
    </g>
  </svg>
  <!-- 点击节点：该人物当夜完整行动详情 -->
  <div v-if="activeDetail" class="node-detail">
    <div class="nd-head">
      <b :style="{ color: campColor(activeDetail.node) }">{{ activeDetail.node.name }}</b>
      <span>{{ activeDetail.node.role }}{{ activeDetail.node.dead ? ' · 当夜逝去' : '' }}</span>
      <button class="nd-close" @click="activeName = ''">✕</button>
    </div>
    <p v-if="!activeDetail.outgoing.length && !activeDetail.incoming.length" class="nd-empty">当夜无记录在案的行动</p>
    <div v-for="(e, i) in activeDetail.outgoing" :key="'o' + i" class="nd-row">
      <span class="nd-arrow" :style="{ color: e.color }">→</span>
      <span>对「{{ e.to }}」{{ e.label }}</span>
    </div>
    <div v-for="(e, i) in activeDetail.incoming" :key="'i' + i" class="nd-row">
      <span class="nd-arrow" :style="{ color: e.color }">←</span>
      <span>被「{{ e.from }}」{{ e.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.night-graph { width: 100%; height: auto; display: block; }
.node-box { fill: #1e2a52; }
.node-name { fill: #e6edf3; font-size: 15px; font-weight: 600; text-anchor: middle; }
.node-role { font-size: 12px; text-anchor: middle; }
.edge-label { font-size: 12px; text-anchor: middle; paint-order: stroke; stroke: #131c3a; stroke-width: 4px; stroke-linejoin: round; }
/* —— 节点弹性入场：依次弹入 —— */
.node-g {
  cursor: pointer;
}
/* 连线按行动顺序依次生长：从起点冒出一路延伸，箭头到位后显现 */
.edge-line {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: edge-grow 0.5s ease-out both;
}
/* 命运相连的关联线：虚线（在生长动画结束后切换为点划线样式） */
.edge-line.edge-dashed {
  animation: edge-grow 0.5s ease-out both;
  stroke-linecap: round;
}
.edge-line.edge-dashed {
  stroke-dasharray: 4 4;
  stroke-dashoffset: 0;
}
@keyframes edge-grow {
  0% { stroke-dashoffset: 1; opacity: 0.25; }
  100% { stroke-dashoffset: 0; opacity: 1; }
}
.edge-label {
  animation: label-in 0.35s ease both;
}
@keyframes label-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
/* 入场缩放作用在内层容器上，避免覆盖外层的定位坐标 */
.node-inner {
  animation: node-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  transform-box: fill-box;
  transform-origin: center;
}
@keyframes node-pop {
  0% { opacity: 0; transform: scale(0.3); }
  100% { opacity: 1; transform: scale(1); }
}
/* 悬停/激活：节点高亮 */
.node-box.node-active {
  filter: drop-shadow(0 0 6px rgba(230, 237, 243, 0.5));
}
/* 非相关连线变暗 */
.edge-dim {
  opacity: 0.18;
}
/* —— 行动详情浮层 —— */
.node-detail {
  margin-top: 8px;
  border: 1px solid #4a5c96;
  border-radius: 8px;
  background: #1e2a52;
  padding: 10px 12px;
  font-size: 13px;
}
.nd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.nd-head b {
  font-size: 14px;
}
.nd-head span {
  color: #9aa7b4;
  font-size: 12px;
}
.nd-close {
  margin-left: auto;
  background: none;
  border: none;
  color: #9aa7b4;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}
.nd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  color: #e6edf3;
}
.nd-arrow {
  font-weight: 700;
  width: 16px;
  text-align: center;
}
.nd-empty {
  color: #9aa7b4;
  font-size: 12px;
}
</style>
