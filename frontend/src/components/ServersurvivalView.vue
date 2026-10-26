<!-- server-survival 服务器保卫战：塔防策略游戏，搬迁自开源项目 pshenok/server-survival（MIT License）
     https://github.com/pshenok/server-survival
     游戏为免构建纯静态项目（three.js r128 + tailwind CDN），存放于 public/3d/serversurvival/，
     本组件仅以 iframe 全屏承载，游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="serversurvival">
    <iframe
      v-if="ready"
      class="serversurvival-frame"
      src="/3d/serversurvival/index.html"
      title="server-survival"
      allow="fullscreen"
    ></iframe>
    <div v-else class="serversurvival-wait">{{ waitMsg }}</div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';
const ready = ref(false);
const waitMsg = ref('正在进入服务器保卫战...');
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
.serversurvival {
  position: fixed;
  top: 48px;
  height: auto !important;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #000;
}
.serversurvival-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.serversurvival-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a94b8;
  font-size: 14px;
}
</style>
