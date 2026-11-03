<template>
  <div v-if="boss" class="boss-ui">
    <div class="boss-bar-wrap">
      <span class="boss-name">{{ boss.name }}</span>
      <span v-if="boss.raged" class="boss-rage">⚡狂暴</span>
      <div class="boss-hp-bar"><div class="boss-hp-fill" :style="{ width: Math.max(0, boss.hp / boss.maxHp * 100) + '%' }"></div></div>
      <span class="boss-hp-num">{{ Math.ceil(boss.hp) }}/{{ boss.maxHp }}</span>
    </div>
    <div class="boss-nodes">
      <span v-for="(n, i) in boss.nodes" :key="i" class="boss-node" :class="{ broken: !n.alive }">
        <span v-if="n.alive" class="bn-icon">⬡</span>
        <span v-else class="bn-icon broken">✕</span>
        <span class="bn-label">{{ n.alive ? Math.ceil(n.hp) : Math.ceil(n.regenT)+'s' }}</span>
      </span>
    </div>
    <div class="boss-state-bar" :class="{
      telegraph: boss.state === 'telegraph',
      overheat: boss.state === 'overheat',
      stun: boss.state === 'stun',
      attack: boss.state === 'attack'
    }">
      <span v-if="boss.state === 'telegraph'">⚠ {{ boss.moveName }} —— 快躲！</span>
      <span v-else-if="boss.state === 'overheat'">🔥 过热窗口 —— 全力输出！</span>
      <span v-else-if="boss.state === 'stun'">💥 眩晕窗口 —— 全力输出！</span>
      <span v-else-if="boss.state === 'move'">↻ 移动中 · 下招：{{ boss.moveName }}</span>
      <span v-else-if="boss.moveName">⚔ {{ boss.moveName }}</span>
      <span v-else>⚔ 战斗中</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  boss: { type: Object, default: null }
})
</script>

<style scoped>
/* Boss 专属 UI（从 DuckovView.vue 抽离） */
.boss-ui { position: absolute; top: 48px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; z-index: 10; }
.boss-bar-wrap { display: flex; align-items: center; gap: 10px; background: rgba(15,23,42,0.85); border: 1px solid rgba(220,38,38,0.5); border-radius: 8px; padding: 5px 14px; }
.boss-name { color: #f87171; font-size: 14px; font-weight: bold; text-shadow: 0 0 8px rgba(248,113,113,0.6); }
.boss-rage { color: #fbbf24; font-size: 12px; font-weight: bold; animation: blink 0.5s infinite; }
.boss-hp-bar { width: 200px; height: 14px; background: rgba(0,0,0,0.5); border: 2px solid #991b1b; border-radius: 7px; overflow: hidden; }
.boss-hp-fill { height: 100%; background: linear-gradient(90deg, #dc2626, #ef4444, #f87171); border-radius: 5px; transition: width 0.15s; }
.boss-hp-num { color: #e2e8f0; font-size: 14px; font-weight: bold; min-width: 78px; text-align: right; }
.boss-nodes { display: flex; gap: 8px; }
.boss-node { display: flex; align-items: center; gap: 4px; background: rgba(15,23,42,0.7); border: 1px solid rgba(34,211,238,0.45); border-radius: 6px; padding: 3px 8px; }
.boss-node.broken { border-color: rgba(156,163,175,0.35); opacity: 0.6; }
.bn-icon { color: #22d3ee; font-size: 14px; }
.bn-icon.broken { color: #9ca3af; }
.bn-label { color: #e2e8f0; font-size: 10px; font-weight: bold; }
.boss-state-bar { color: #e2e8f0; font-size: 12px; font-weight: bold; background: rgba(15,23,42,0.7); border-radius: 6px; padding: 3px 14px; border: 1px solid rgba(148,163,184,0.3); }
.boss-state-bar.telegraph { color: #fbbf24; border-color: rgba(251,191,36,0.6); animation: blink 0.35s infinite; }
.boss-state-bar.overheat { color: #f87171; border-color: rgba(248,113,113,0.6); background: rgba(127,29,29,0.3); }
.boss-state-bar.stun { color: #fde047; border-color: rgba(253,224,71,0.6); background: rgba(113,63,18,0.3); }
.boss-state-bar.attack { color: #fca5a5; border-color: rgba(252,165,165,0.6); }
</style>
