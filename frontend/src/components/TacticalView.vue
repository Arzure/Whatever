<!-- 战术突袭：自研 CS:GO 炸弹拆除模式 FPS
     Three.js 单文件游戏，存放于 public/3d/tactical/，
     本组件以 iframe 全屏承载 -->
<template>
  <div class="tactical">
    <iframe
      v-if="ready"
      class="tactical-frame"
      src="/3d/tactical/index.html"
      title="战术突袭"
      allow="fullscreen"
    ></iframe>
    <div v-else class="tactical-wait">{{ waitMsg }}</div>
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
.tactical {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #000;
}
.tactical-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.tactical-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
}
</style>
