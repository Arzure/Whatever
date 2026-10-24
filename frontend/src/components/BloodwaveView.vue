<!-- 僵尸波次：搬迁自开源项目 imr4n4lif/bloodwave-fps-game
     https://github.com/imr4n4lif/bloodwave-fps-game
     原项目为 Three.js 纯 JS 无构建步骤，存放于 public/3d/bloodwave/，
     本组件以 iframe 全屏承载，游戏体验与原版一致 -->
<template>
  <div class="bloodwave">
    <iframe
      v-if="ready"
      class="bloodwave-frame"
      src="/3d/bloodwave/index.html"
      title="僵尸波次"
      allow="fullscreen"
    ></iframe>
    <div v-else class="bloodwave-wait">{{ waitMsg }}</div>
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
.bloodwave {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #000;
}
.bloodwave-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.bloodwave-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
}
</style>
