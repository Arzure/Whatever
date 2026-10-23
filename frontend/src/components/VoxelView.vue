<!-- 方块世界：完整搬迁自开源项目 EVEDensity/MineWorld（MIT License）
     https://github.com/EVEDensity/MineWorld
     游戏为无构建步骤的原生 ES Module 项目，整体存放于 public/3d/mineworld/，
     本组件仅以 iframe 全屏承载，游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="voxel">
    <!-- 返回游戏中心的入口统一由顶栏『<』按钮接管，游戏内不再放固定按钮 -->
    <iframe
      class="voxel-frame"
      src="/3d/mineworld/index.html"
      title="像素方块世界"
      allow="fullscreen"
    ></iframe>
  </div>
</template>

<script setup>
// 纯承载视图：游戏运行于 iframe 内，无交互逻辑
</script>

<style scoped>
/* 容器不带 filter/transform：保证顶栏与 iframe 层级稳定 */
.voxel {
  position: fixed;
  inset: 0;
  z-index: 1;
  background: #000;
}
.voxel-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
</style>
