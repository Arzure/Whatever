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
    <transition name="jump-score-pop">
      <div v-if="ready && score > 0" class="jump-score" :key="score">{{ score }}</div>
    </transition>
    <transition name="jump-retry-fade">
      <button v-if="ready && gameOver" class="jump-retry" @click="retry">
        <span class="jump-retry-score">本局跳过 {{ finalScore }} 个</span>
        <span class="jump-retry-btn">重新开始</span>
      </button>
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
const score = ref(0);
const finalScore = ref(0);

function onMessage(e) {
  if (!e.data || typeof e.data !== 'object') return;
  if (e.data.type === 'jump-score') {
    score.value = e.data.score || 0;
  } else if (e.data.type === 'jump-gameover') {
    finalScore.value = e.data.score ?? score.value;
    gameOver.value = true;
  }
}

function retry() {
  gameOver.value = false;
  score.value = 0;
  finalScore.value = 0;
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
  height: auto !important;
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
/* 实时跳跃计数：顶部居中大数字徽章 */
.jump-score {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 56px;
  padding: 6px 18px;
  border-radius: 999px;
  background: rgba(19, 26, 46, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(212, 161, 44, 0.35);
  color: #ffd76a;
  font-size: 26px;
  font-weight: 800;
  text-align: center;
  z-index: 10;
  pointer-events: none;
}
.jump-score-pop-enter-active {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
}
.jump-score-pop-enter-from {
  opacity: 0;
  transform: translateX(-50%) scale(0.6);
}
/* 游戏结束 Retry：得分 + 按钮 */
.jump-retry {
  position: absolute;
  bottom: 18%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 36px;
  border: 1px solid var(--border, #444);
  border-radius: 14px;
  background: var(--panel, #1a1a2e);
  color: var(--text, #eee);
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  transition: border-color 0.2s, transform 0.2s;
}
.jump-retry:hover {
  border-color: var(--accent, #d4a12c);
  transform: translateX(-50%) translateY(-2px);
}
.jump-retry-score {
  font-size: 14px;
  color: var(--text-dim, #8b949e);
}
.jump-retry-score b {
  color: #ffd76a;
  font-size: 18px;
  font-weight: 700;
}
.jump-retry-btn {
  font-size: 16px;
  font-weight: 600;
}
.jump-retry-fade-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.jump-retry-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
