<!-- 跳一跳：搬迁自开源项目 shenmaxg/web-jump（MIT License）
     https://github.com/shenmaxg/web-jump
     原项目为 Three.js + Webpack，build 产物存放于 public/3d/jump/，
     本组件以 iframe 全屏承载，游戏体验与原版一致 -->
<template>
  <div class="jump">
    <iframe
      v-if="ready"
      class="jump-frame"
      :src="frameSrc"
      title="跳一跳"
      allow="fullscreen"
    ></iframe>
    <div v-else class="jump-wait">{{ waitMsg }}</div>
    <transition name="jump-retry-fade">
      <button v-if="ready && gameOver" class="jump-retry" @click="retry">重新开始</button>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api';

const ready = ref(false);
const waitMsg = ref('正在加载...');
const frameSrc = ref('/3d/jump/index.html');
const gameOver = ref(false);

function onMessage(e) {
  if (e.data && e.data.type === 'jump-gameover') {
    gameOver.value = true;
  }
}

function retry() {
  gameOver.value = false;
  frameSrc.value = '/3d/jump/index.html?t=' + Date.now();
}

onMounted(async () => {
  window.addEventListener('message', onMessage);
  try {
    await api.ticket3d();
    ready.value = true;
  } catch {
    ready.value = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
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
.jump-retry {
  position: absolute;
  bottom: 18%;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 32px;
  border: 1px solid var(--border, #444);
  border-radius: 10px;
  background: var(--panel, #1a1a2e);
  color: var(--text, #eee);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition: border-color 0.2s, transform 0.2s;
}
.jump-retry:hover {
  border-color: var(--accent, #d4a12c);
  transform: translateX(-50%) translateY(-2px);
}
.jump-retry-fade-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.jump-retry-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
