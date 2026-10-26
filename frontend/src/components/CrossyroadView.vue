<!-- crossyroad 过马路：Crossy Road 克隆，搬迁自开源项目 EvanBacon/Expo-Crossy-Road（MIT License）
     https://github.com/EvanBacon/Expo-Crossy-Road
     游戏经 Expo web 导出构建（experiments.baseUrl=/3d/crossyroad/）后存放于 public/3d/crossyroad/，
     本组件仅以 iframe 全屏承载，游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="crossyroad">
    <iframe
      v-if="ready"
      class="crossyroad-frame"
      src="/3d/crossyroad/"
      title="crossyroad"
      allow="fullscreen"
    ></iframe>
    <div v-else class="crossyroad-wait">{{ waitMsg }}</div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';
const ready = ref(false);
const waitMsg = ref('正在进入过马路...');
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
.crossyroad {
  position: fixed;
  top: 48px;
  height: auto !important;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #87C6FF;
}
.crossyroad-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.crossyroad-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a94b8;
  font-size: 14px;
}
</style>
