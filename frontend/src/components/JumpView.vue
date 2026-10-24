<!-- 跳一跳：搬迁自开源项目 shenmaxg/web-jump（MIT License）
     https://github.com/shenmaxg/web-jump
     原项目为 Three.js + Webpack，build 产物存放于 public/3d/jump/，
     本组件以 iframe 全屏承载，游戏体验与原版一致 -->
<template>
  <div class="jump">
    <iframe
      v-if="ready"
      class="jump-frame"
      src="/3d/jump/index.html"
      title="跳一跳"
      allow="fullscreen"
    ></iframe>
    <div v-else class="jump-wait">{{ waitMsg }}</div>
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
.jump {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #000;
}
.jump-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.jump-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
}
</style>
