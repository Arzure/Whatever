<!-- SYNTH*BLAST 复古赛博朋克坦克射击：搬迁自开源项目 brianrisk/SYNTHBLAST-threejs-game（Apache-2.0）
     https://github.com/brianrisk/SYNTHBLAST-threejs-game
     游戏经 Vite 构建后存放于 public/3d/synthblast/，
     本组件仅以 iframe 全屏承载，游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="synthblast">
    <iframe
      v-if="ready"
      class="synthblast-frame"
      src="/3d/synthblast/index.html"
      title="SYNTH*BLAST"
      allow="fullscreen"
    ></iframe>
    <div v-else class="synthblast-wait">{{ waitMsg }}</div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const ready = ref(false);
const waitMsg = ref('正在进入 SYNTH*BLAST...');

onMounted(async () => {
  try {
    await api.ticket3d();
    ready.value = true;
  } catch {
    waitMsg.value = '进入失败：请先登录，再从游戏中心进入';
  }
});
</script>
<style scoped>
.synthblast {
  position: fixed;
  top: 48px;
  height: auto !important;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #000;
}
.synthblast-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.synthblast-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a94b8;
  font-size: 14px;
}
</style>
