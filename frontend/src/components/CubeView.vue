<!-- 魔方：完整搬迁自开源项目 joews/rubik-js（MIT License）
     https://github.com/joews/rubik-js
     游戏为无构建步骤的原生 JS 项目（three.js 已内置 lib/），
     整体存放于 public/3d/cube/，本组件仅以 iframe 全屏承载，
     游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="cube">
    <!-- 返回游戏中心的入口统一由顶栏『<』按钮接管，游戏内不再放固定按钮 -->
    <iframe
      v-if="ready"
      class="cube-frame"
      src="/3d/cube/index.html"
      title="魔方"
      allow="fullscreen"
    ></iframe>
    <div v-else class="cube-wait">{{ waitMsg }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';
// 3D 资源已纳入登录票据保护：先领取票据（HttpOnly cookie，Path=/3d/），
// 成功后再挂载 iframe——否则 iframe 首个请求就会收到 401
const ready = ref(false);
const waitMsg = ref('正在进入魔方还原...');
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
/* 容器不带 filter/transform：保证顶栏与 iframe 层级稳定 */
.cube {
  position: fixed;
  inset: 0;
  z-index: 1;
  background: #000;
}
.cube-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.cube-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a94b8;
  font-size: 14px;
}
</style>
