<!-- 台球：搬迁自开源项目 tailuge/billiards（MIT License）
     https://github.com/tailuge/billiards
     原项目为 TypeScript + WebGL，dist 产物存放于 public/3d/billiards/，
     本组件以 iframe 全屏承载，游戏体验与原版一致 -->
<template>
  <div class="billiards">
    <iframe
      v-if="ready"
      class="billiards-frame"
      src="/3d/billiards/index.html"
      title="台球"
      allow="fullscreen"
    ></iframe>
    <div v-else class="billiards-wait">{{ waitMsg }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const ready = ref(false);
const waitMsg = ref('正在加载...');

onMounted(async () => {
  try {
    await api.ticket3d();
    ready.value = true;
  } catch {
    ready.value = true;
  }
});
</script>

<style scoped>
.billiards {
  position: fixed;
  top: 48px;
  height: auto !important;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #1a472a;
}
.billiards-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.billiards-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
}
</style>
