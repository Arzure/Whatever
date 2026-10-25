<!-- HexGL 未来赛车：完整搬迁自开源项目 BKcore/HexGL（MIT License）
     https://github.com/BKcore/HexGL
     游戏为预构建 JS+音效资源，整体存放于 public/3d/hexgl/，
     本组件仅以 iframe 全屏承载，游戏代码零改动，效果与原版完全一致 -->
<template>
  <div class="hexgl">
    <!-- 返回游戏中心的入口统一由顶栏『<』按钮接管，游戏内不再放固定按钮 -->
    <iframe
      v-if="ready"
      class="hexgl-frame"
      src="/3d/hexgl/index.html"
      title="未来赛车"
      allow="fullscreen"
      @load="onFrameLoad"
    ></iframe>
    <div v-else class="hexgl-wait">{{ waitMsg }}</div>
    <!-- 资源加载进度浮层：游戏内进度条较隐蔽（白条渐长），这里同步展示醒目的百分比进度 -->
    <div v-if="loading" class="hexgl-loading">
      <div class="hexgl-loading-title">正在加载赛道资源</div>
      <div class="hexgl-loading-bar">
        <div class="hexgl-loading-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <div class="hexgl-loading-pct">{{ progress }}%</div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api';
// 3D 资源已纳入登录票据保护：先领取票据（HttpOnly cookie，Path=/3d/），
// 成功后再挂载 iframe——否则 iframe 首个请求就会收到 401
const ready = ref(false);
const waitMsg = ref('正在进入未来赛车...');
const loading = ref(false);
const progress = ref(0);
let timer = null;
function onFrameLoad() {
  // 同源 iframe：轮询游戏内部 step-3 进度条宽度，同步到外层醒目进度浮层；
  // step-4（赛道就绪）出现后自动隐藏
  timer = setInterval(() => {
    try {
      const doc = document.querySelector('.hexgl-frame').contentWindow.document;
      const step3 = doc.getElementById('step-3');
      const step4 = doc.getElementById('step-4');
      if (step4 && step4.style.display !== 'none') {
        loading.value = false;
        if (timer) { clearInterval(timer); timer = null; }
        return;
      }
      if (step3 && step3.style.display !== 'none') {
        const bar = doc.getElementById('progressbar');
        const w = bar && bar.style.width ? parseFloat(bar.style.width) : 0;
        progress.value = Math.min(100, Math.max(0, Math.round(w || 0)));
        loading.value = true;
      }
    } catch {
      // iframe 未就绪或已离开，忽略本轮
    }
  }, 300);
}
onMounted(async () => {
  try {
    await api.ticket3d();
    ready.value = true;
  } catch {
    waitMsg.value = '进入失败：请先登录，再从游戏中心进入';
  }
});
onBeforeUnmount(() => {
  if (timer) { clearInterval(timer); timer = null; }
});
</script>
<style scoped>
/* 容器不带 filter/transform：保证顶栏与 iframe 层级稳定；
   top: 48px 从顶栏下沿开始，游戏画面完整不被顶栏遮挡 */
.hexgl {
  position: fixed;
  top: 48px;
  height: auto !important;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: #000;
}
.hexgl-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
.hexgl-wait {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a94b8;
  font-size: 14px;
}
/* —— 资源加载进度浮层：居中卡片 + 醒目进度条 —— */
.hexgl-loading {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, 78vw);
  padding: 26px 30px 22px;
  border-radius: 14px;
  background: rgba(14, 20, 40, 0.92);
  border: 1px solid rgba(120, 160, 255, 0.28);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
  text-align: center;
  z-index: 5;
}
.hexgl-loading-title {
  color: #dfe6ff;
  font-size: 15px;
  letter-spacing: 2px;
  margin-bottom: 16px;
}
.hexgl-loading-bar {
  height: 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.hexgl-loading-fill {
  height: 100%;
  border-radius: 6px;
  background: linear-gradient(90deg, #4f8cff, #7ec8ff);
  box-shadow: 0 0 12px rgba(110, 170, 255, 0.8);
  transition: width 0.3s ease;
}
.hexgl-loading-pct {
  margin-top: 10px;
  color: #8fb4ff;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
</style>
