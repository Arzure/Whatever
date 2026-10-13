<script setup>
// 逐夜行动关系图：人物为节点（含真实身份），行动为带箭头连线，每夜一张
import { computed } from 'vue';

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
  if (l.warlock && l.warlock.links && l.warlock.links.length === 2) e.push({ from: l.warlock.links[0], to: l.warlock.links[1], label: '命运链接', type: 'link' });
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
      // 自环（如守卫自保）：在节点上方画一个小弧
      const path = `M ${a.x - 16} ${a.y - 26} C ${a.x - 44} ${a.y - 78}, ${a.x + 44} ${a.y - 78}, ${a.x + 16} ${a.y - 26}`;
      return { ...e, path, lx: a.x, ly: a.y - 66, color };
    }
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = mx - cx, dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    const bend = 0.28 + (i % 3) * 0.14; // 多条边错开弧度
    const c = { x: mx + (dx / len) * R * bend, y: my + (dy / len) * R * bend };
    const s = quadPoint(a, c, b, 0.1);
    const t = quadPoint(a, c, b, 0.9);
    const mid = quadPoint(a, c, b, 0.5);
    return { ...e, path: `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${t.x} ${t.y}`, lx: mid.x, ly: mid.y, color };
  }).filter(Boolean);

  return { W, H, nodes, edges: geo };
});

function campColor(n) { return CAMP_COLOR[n.camp] || '#8b949e'; }
</script>

<template>
  <svg :viewBox="`0 0 ${graph.W} ${graph.H}`" class="night-graph" role="img" :aria-label="`第${log.round}夜行动关系图`">
    <defs>
      <marker v-for="(color, type) in EDGE_COLOR" :id="`ng-arrow-${log.round}-${type}`" :key="type"
        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" :fill="color" />
      </marker>
    </defs>
    <path v-for="(e, i) in graph.edges" :key="'e' + i" :d="e.path" :stroke="e.color" stroke-width="2" fill="none"
      :marker-end="`url(#ng-arrow-${log.round}-${e.type})`" />
    <text v-for="(e, i) in graph.edges" :key="'l' + i" :x="e.lx" :y="e.ly" class="edge-label" :fill="e.color">{{ e.label }}</text>
    <g v-for="n in graph.nodes" :key="n.name" :transform="`translate(${n.x},${n.y})`">
      <rect x="-50" y="-27" width="100" height="54" rx="9" class="node-box" :stroke="campColor(n)" stroke-width="2" />
      <text y="-3" class="node-name">{{ n.name }}</text>
      <text y="17" class="node-role" :fill="campColor(n)">{{ n.role }}{{ n.dead ? ' 💀' : '' }}</text>
    </g>
  </svg>
</template>

<style scoped>
.night-graph { width: 100%; height: auto; display: block; }
.node-box { fill: #161b22; }
.node-name { fill: #e6edf3; font-size: 15px; font-weight: 600; text-anchor: middle; }
.node-role { font-size: 12px; text-anchor: middle; }
.edge-label { font-size: 12px; text-anchor: middle; paint-order: stroke; stroke: #0d1117; stroke-width: 4px; stroke-linejoin: round; }
</style>
