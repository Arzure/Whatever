<!-- 方块世界：完整搬迁自开源项目 EVEDensity/MineWorld（MIT License）
     https://github.com/EVEDensity/MineWorld
     游戏为无构建步骤的原生 ES Module 项目，整体存放于 public/3d/mineworld/，
     本组件仅以 iframe 全屏承载，游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="voxel">
    <button class="voxel-back" title="返回游戏中心" @click="backHub"><Icon name="back" :size="16" /> <span>返回</span></button>
    <iframe
      class="voxel-frame"
      src="/3d/mineworld/index.html"
      title="像素方块世界"
      allow="fullscreen"
    ></iframe>
  </div>
</template>

<script setup>
import Icon from './Icon.vue';
import { inject } from 'vue';
const { state } = inject('game');
function backHub() {
  state.view = 'hub';
}
</script>

<style scoped>
/* 容器不带 filter/transform：保证返回按钮的 fixed 定位相对视口生效（踩坑教训） */
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
.voxel-back {
  position: fixed;
  top: calc(var(--bar-h, 48px) + 14px);
  left: 18px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 14px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.voxel-back:hover { border-color: var(--accent); }
</style>
