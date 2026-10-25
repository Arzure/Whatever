<!-- gorescript classic：复古 FPS 射击游戏，搬迁自开源项目 gorescript/gorescript（MIT License）
     https://github.com/gorescript/gorescript
     游戏经手动构建（vendor+client JS 拼接 + assets.zip 资源包）后存放于 public/3d/gorescript/，
     本组件仅以 iframe 全屏承载，游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="gorescript">
    <iframe
      v-if="ready"
      class="gorescript-frame"
      src="/3d/gorescript/index.html"
      title="gorescript"
      allow="fullscreen"
    ></iframe>
    <div v-else class="gorescript-wait">{{ waitMsg }}</div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const ready = ref(false);
const waitMsg = ref('正在进入 gorescript...');

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
.gorescript {
  position: fixed;
  top: 48px;
  height: auto !important;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #000;
}
.gorescript-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.gorescript-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a94b8;
  font-size: 14px;
}
</style>
