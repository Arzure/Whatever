<template>
  <div class="hub" ref="hubEl" :class="{ expanding: expanding }">
    <div class="hub-head">
      <h1 class="hub-title">3D 世界</h1>
    </div>
    <div class="hub-grid">
      <div
        v-for="(g, i) in games"
        :key="g.id"
        class="hub-card"
        :style="{ animationDelay: (0.15 + i * 0.12) + 's' }"
        @mousemove="onCardMove"
        @mouseleave="onCardLeave"
        @click="enterGame(g.id)"
        role="button"
        tabindex="0"
        @keydown.enter="enterGame(g.id)"
      >
        <div class="hub-preview" aria-hidden="true">
          <!-- 预览动效按游戏区分：方块世界为像素草地+悬浮方块，其余为砍击动效 -->
          <template v-if="g.id === 'voxel'">
            <span class="gp-vground"></span>
            <span class="gp-vblock gp-vb1"></span>
            <span class="gp-vblock gp-vb2"></span>
            <span class="gp-vblock gp-vb3"></span>
          </template>
          <template v-else-if="g.id === 'ironhold'">
            <span class="gp-iground"></span>
            <span class="gp-cross"></span>
            <span class="gp-target gp-t1"></span>
            <span class="gp-target gp-t2"></span>
          </template>
          <template v-else-if="g.id === 'cube'">
            <span class="gp-cshine"></span>
            <span class="gp-rcube">
              <span class="gp-rscene">
                <span v-for="ly in 3" :key="ly" class="gp-rlayer" :class="'gp-rl' + ly">
                  <span class="gp-rturn" :class="'gp-rt' + ly">
                    <span
                      v-for="i in 9"
                      :key="i"
                      class="gp-rcubie"
                      :style="cubieTransform(i)"
                    >
                      <span
                        v-for="f in 6"
                        :key="f"
                        class="gp-rface"
                        :class="'gp-rf' + f"
                        :style="faceStyle(ly, i, f)"
                      ></span>
                    </span>
                  </span>
                </span>
              </span>
            </span>
          </template>
          <template v-else>
            <span class="gp-grid"></span>
            <span class="gp-cube gp-c1"></span>
            <span class="gp-cube gp-c2"></span>
            <span class="gp-cube gp-c3"></span>
            <span class="gp-slash"></span>
          </template>
          <span class="gp-badge">{{ g.badge }}</span>
        </div>
        <div class="hub-info">
          <span class="hub-icon"><Icon :name="g.icon" :size="22" /></span>
          <span class="hub-text">
            <b>{{ g.name }}</b>
            <em>{{ g.desc }}</em>
          </span>
          <span class="hub-arrow">›</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import Icon from './Icon.vue';
import { ref, inject, onMounted } from 'vue';

const { state } = inject('game');
// —— FLIP 共享元素扩张：从首页 3D 卡片的矩形位置放大铺满全屏 ——
// 首页点击时已把卡片矩形存入 state.hubRect；挂载后先摆到卡片位置，
// 下一帧解除定位并过渡回全屏，视觉上就是卡片扩张成了游戏中心界面
const hubEl = ref(null);
const expanding = ref(false);
onMounted(() => {
  const el = hubEl.value;
  const rect = state.hubRect;
  if (!el || !rect) return;
  const sx = rect.width / window.innerWidth;
  const sy = rect.height / window.innerHeight;
  el.style.transformOrigin = '0 0';
  el.style.transform = `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      expanding.value = true; // 触发过渡：回到全屏位置
      el.style.transform = '';
      setTimeout(() => {
        expanding.value = false;
        el.style.transformOrigin = '';
        state.hubRect = null; // 用完即清，避免影响下次直接进入
      }, 520);
    });
  });
});

// 游戏清单：数据驱动，以后加游戏只需注册一条数据
const games = [
  {
    id: 'ironhold',
    name: '铁壁行动',
    desc: '第一人称射击 · 守住防线 · 火力全开',
    icon: 'sword',
    badge: 'FPS 3D',
  },
  {
    id: 'voxel',
    name: '方块世界',
    desc: '像素沙盒 · 自由建造 · 探索世界',
    icon: 'sword',
    badge: 'VOXEL 3D',
  },
  {
    id: 'cube',
    name: '魔方',
    desc: '经典魔方 · 打乱还原 · 多阶挑战',
    icon: 'sword',
    badge: 'CUBE 3D',
  },
  {
    id: 'slash',
    name: '挥剑挑战',
    desc: '挥剑切割 · 面状拖尾 · 计分挑战',
    icon: 'sword',
    badge: 'LIVE 3D',
  },
];

// —— 魔方预览：3x3x3 立方体，三层各自独立旋转，周期性展开/收拢 ——
const CUBE_COLORS = {
  front: '#4a9e5c',
  back: '#4a7fd4',
  left: '#e8833a',
  right: '#d9534f',
  top: '#e9edf2',
  bottom: '#f2c14e',
  inner: '#0d1322',
};
function cubieTransform(i) {
  const c = (i - 1) % 3;
  const r = Math.floor((i - 1) / 3);
  return { transform: `translate3d(${(c - 1) * 22}px, 0, ${(r - 1) * 22}px)` };
}
function faceStyle(ly, i, f) {
  const c = (i - 1) % 3;
  const r = Math.floor((i - 1) / 3);
  // 外露面按标准六面配色；内面统一白色，展开时干净清爽
  let color = CUBE_COLORS.top;
  if (f === 1 && r === 0) color = CUBE_COLORS.front;
  else if (f === 2 && r === 2) color = CUBE_COLORS.back;
  else if (f === 3 && c === 0) color = CUBE_COLORS.left;
  else if (f === 4 && c === 2) color = CUBE_COLORS.right;
  else if (f === 5 && ly === 1) color = CUBE_COLORS.top;
  else if (f === 6 && ly === 3) color = CUBE_COLORS.bottom;
  return { background: color };
}

function enterGame(id) {
  state.view = id;
}

// 卡片 3D 倾斜跟随（与首页入口卡片同款手感）
function onCardMove(e) {
  const el = e.currentTarget;
  const rc = el.getBoundingClientRect();
  const px = (e.clientX - rc.left) / rc.width - 0.5;
  const py = (e.clientY - rc.top) / rc.height - 0.5;
  el.style.transform = `perspective(560px) rotateX(${(-py * 14).toFixed(2)}deg) rotateY(${(px * 16).toFixed(2)}deg) translateY(-4px) scale(1.03)`;
}
function onCardLeave(e) {
  e.currentTarget.style.transform = '';
}
</script>

<style scoped>
.hub {
  height: 100%;
  padding-top: var(--bar-h, 48px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: transparent;
  /* FLIP 扩张过渡：从首页卡片矩形位置放大铺满全屏（0.5s 与首页离场节奏衔接） */
  transition: transform 0.5s cubic-bezier(0.32, 0.72, 0.24, 1);
}
.hub-head {
  text-align: center;
  margin: 26px 0 22px;
  animation: hub-in 0.5s ease both;
}
@keyframes hub-in {
  from { opacity: 0; transform: translateY(10px); filter: blur(4px); }
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}
.hub-title {
  margin: 0;
  font-size: 30px;
  color: var(--text);
  letter-spacing: 0.06em;
}
.hub-sub {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--muted, #8a94b8);
}
.hub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 420px));
  gap: 14px;
  width: min(92%, 880px);
  margin-bottom: 40px;
}
/* 游戏卡片：复用首页 3D 世界卡片的视觉语言 */
.hub-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(212, 161, 44, 0.18);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(212, 161, 44, 0.08), rgba(60, 90, 160, 0.08)), var(--panel-2);
  cursor: pointer;
  overflow: hidden;
  animation: hub-in 0.55s ease both;
  box-shadow: 0 0 18px rgba(212, 161, 44, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  transition: border-color 0.2s, transform 0.18s ease-out, box-shadow 0.2s;
}
.hub-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 11px;
  padding: 1.5px;
  background: conic-gradient(from var(--ang, 0deg), transparent 0%, var(--accent-2) 12%, transparent 28%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0.55;
  transition: opacity 0.3s;
  pointer-events: none;
  animation: border-spin 2.8s linear infinite;
  z-index: 2;
}
@property --ang {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
@keyframes border-spin { to { --ang: 360deg; } }
.hub-card:hover::before { opacity: 1; }
.hub-card:hover {
  border-color: var(--accent);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45), 0 0 34px color-mix(in srgb, var(--accent-2) 22%, transparent);
}
.hub-card:hover .hub-icon { transform: scale(1.12); }
/* 预览画面：与首页 3D 卡片同款 CSS 动效 */
.hub-preview {
  position: relative;
  height: 150px;
  background: radial-gradient(ellipse at 50% 130%, rgba(109, 90, 224, 0.28), transparent 62%), linear-gradient(180deg, #0b1122, #141d3d);
  overflow: hidden;
}
.gp-grid {
  position: absolute;
  left: -40%;
  right: -40%;
  bottom: -34px;
  height: 92px;
  background:
    repeating-linear-gradient(90deg, rgba(212, 161, 44, 0.28) 0 1px, transparent 1px 44px),
    repeating-linear-gradient(0deg, rgba(212, 161, 44, 0.22) 0 1px, transparent 1px 22px);
  transform: perspective(210px) rotateX(56deg);
  transform-origin: top center;
  opacity: 0.55;
  animation: gp-scroll 1.5s linear infinite;
}
@keyframes gp-scroll {
  from { background-position: 0 0, 0 0; }
  to { background-position: 0 0, 0 22px; }
}
.gp-cube {
  position: absolute;
  width: 13px;
  height: 13px;
  border: 1.5px solid rgba(212, 161, 44, 0.95);
  background: rgba(212, 161, 44, 0.16);
  border-radius: 2px;
  animation: gp-fly 2.7s linear infinite;
}
.gp-c1 { left: 32%; top: 34%; }
.gp-c2 { left: 54%; top: 46%; animation-delay: 0.9s; }
.gp-c3 { left: 68%; top: 24%; animation-delay: 1.8s; border-color: rgba(109, 90, 224, 0.95); background: rgba(109, 90, 224, 0.16); }
@keyframes gp-fly {
  0% { transform: scale(0.15); opacity: 0; }
  16% { opacity: 0.95; }
  78% { opacity: 0.95; }
  100% { transform: scale(3.4) translateY(16px); opacity: 0; }
}
.gp-slash {
  position: absolute;
  top: -12%;
  bottom: -12%;
  width: 2px;
  background: linear-gradient(180deg, transparent, #d4a12c 22%, #fff 50%, #d4a12c 78%, transparent);
  box-shadow: 0 0 14px 3px rgba(212, 161, 44, 0.5);
  transform: rotate(22deg);
  opacity: 0;
  animation: gp-slash 2.7s ease-in-out infinite;
}
@keyframes gp-slash {
  0%, 52% { left: -8%; opacity: 0; }
  57% { opacity: 1; }
  82% { left: 104%; opacity: 0.85; }
  87%, 100% { left: 104%; opacity: 0; }
}
.gp-badge {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #d4a12c;
  border: 1px solid rgba(212, 161, 44, 0.4);
  border-radius: 5px;
  padding: 2px 7px;
  background: rgba(11, 17, 34, 0.55);
  backdrop-filter: blur(3px);
}
/* —— 方块世界预览：像素草地 + 悬浮像素方块（与游戏内像素风一致） —— */
.gp-vground {
  position: absolute;
  left: -4%;
  right: -4%;
  bottom: 0;
  height: 44px;
  background: repeating-linear-gradient(90deg, rgba(94, 168, 82, 0.9) 0 16px, rgba(74, 138, 66, 0.9) 16px 32px);
  border-top: 3px solid rgba(140, 200, 120, 0.9);
  box-shadow: 0 -6px 18px rgba(94, 168, 82, 0.25);
}
.gp-vblock {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.28);
  border-radius: 2px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
  animation: gp-vfloat 2.6s ease-in-out infinite;
}
.gp-vb1 { left: 30%; bottom: 62px; background: rgba(94, 168, 82, 0.95); }
.gp-vb2 { left: 52%; bottom: 84px; background: rgba(160, 116, 68, 0.95); animation-delay: 0.7s; }
.gp-vb3 { left: 68%; bottom: 68px; background: rgba(150, 150, 150, 0.95); animation-delay: 1.4s; }
@keyframes gp-vfloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-10px) rotate(6deg); }
}
/* —— 铁壁行动预览：地平线网格 + 呼吸准星 + 移动靶 —— */
.gp-iground {
  position: absolute;
  left: -40%;
  right: -40%;
  bottom: -30px;
  height: 80px;
  background:
    repeating-linear-gradient(90deg, rgba(212, 161, 44, 0.24) 0 1px, transparent 1px 40px),
    repeating-linear-gradient(0deg, rgba(212, 161, 44, 0.18) 0 1px, transparent 1px 20px);
  transform: perspective(210px) rotateX(58deg);
  transform-origin: top center;
  opacity: 0.5;
  animation: gp-scroll 1.2s linear infinite;
}
.gp-cross {
  position: absolute;
  left: 50%;
  top: 46%;
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
  border: 2px solid rgba(230, 237, 243, 0.92);
  border-radius: 50%;
  box-shadow: 0 0 12px rgba(212, 161, 44, 0.5);
  animation: gp-cross-pulse 1.6s ease-in-out infinite;
}
.gp-cross::before,
.gp-cross::after {
  content: '';
  position: absolute;
  background: rgba(230, 237, 243, 0.92);
}
.gp-cross::before { left: 50%; top: -8px; bottom: -8px; width: 2px; margin-left: -1px; }
.gp-cross::after { top: 50%; left: -8px; right: -8px; height: 2px; margin-top: -1px; }
@keyframes gp-cross-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); }
}
.gp-target {
  position: absolute;
  width: 34px;
  height: 34px;
  border: 2px solid rgba(212, 161, 44, 0.9);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(212, 161, 44, 0.35) 0 30%, transparent 32%);
  animation: gp-target-move 3s linear infinite;
}
.gp-t1 { top: 28%; }
.gp-t2 { top: 52%; animation-delay: 1.5s; border-color: rgba(109, 90, 224, 0.9); background: radial-gradient(circle, rgba(109, 90, 224, 0.35) 0 30%, transparent 32%); }
@keyframes gp-target-move {
  0% { left: -12%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { left: 96%; opacity: 0; }
}
/* —— 魔方预览：3D 立方体，三层独立旋转 + 周期性展开收拢 —— */
.gp-cshine {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 70% 55% at 50% 45%, rgba(109, 90, 224, 0.3), transparent 70%), linear-gradient(180deg, #0b1122, #141d3d);
}
.gp-rcube {
  position: absolute;
  inset: 0;
  perspective: 620px;
}
.gp-rscene {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  animation: gp-rscene-spin 16s linear infinite;
}
@keyframes gp-rscene-spin {
  from { transform: rotateX(-26deg) rotateY(0deg); }
  to { transform: rotateX(-26deg) rotateY(360deg); }
}
/* 三层：上层向上展开、下层向下展开、中层保持，周期性分离再收拢回完美立方体 */
.gp-rlayer {
  position: absolute;
  transform-style: preserve-3d;
}
.gp-rl1 { animation: gp-rl-explode-up 9s ease-in-out infinite; }
.gp-rl2 { transform: translateY(0); }
.gp-rl3 { animation: gp-rl-explode-down 9s ease-in-out infinite; }
@keyframes gp-rl-explode-up {
  0%, 16% { transform: translateY(-22px); }
  36%, 60% { transform: translateY(-52px); }
  82%, 100% { transform: translateY(-22px); }
}
@keyframes gp-rl-explode-down {
  0%, 16% { transform: translateY(22px); }
  36%, 60% { transform: translateY(52px); }
  82%, 100% { transform: translateY(22px); }
}
/* 每层独立做 90° 逐级转动，错峰延迟；周期结束回到 360°=还原状态 */
.gp-rturn {
  position: absolute;
  transform-style: preserve-3d;
}
.gp-rt1 { animation: gp-rl-turn 12s cubic-bezier(0.45, 0.05, 0.25, 1) infinite; }
.gp-rt2 { animation: gp-rl-turn 12s cubic-bezier(0.45, 0.05, 0.25, 1) infinite; animation-delay: -4s; }
.gp-rt3 { animation: gp-rl-turn 12s cubic-bezier(0.45, 0.05, 0.25, 1) infinite; animation-delay: -8s; }
@keyframes gp-rl-turn {
  0% { transform: rotateY(0deg); }
  8% { transform: rotateY(90deg); }
  30% { transform: rotateY(90deg); }
  38% { transform: rotateY(180deg); }
  60% { transform: rotateY(180deg); }
  68% { transform: rotateY(270deg); }
  90% { transform: rotateY(270deg); }
  100% { transform: rotateY(360deg); }
}
/* 27 个小方块：外露面按标准六面配色，内面深色 */
.gp-rcubie {
  position: absolute;
  left: -10px;
  top: -10px;
  width: 20px;
  height: 20px;
  transform-style: preserve-3d;
}
.gp-rface {
  position: absolute;
  inset: 0;
  border-radius: 3px;
  border: 1px solid rgba(5, 8, 16, 0.55);
  backface-visibility: hidden;
}
.gp-rf1 { transform: translateZ(10px); }
.gp-rf2 { transform: rotateY(180deg) translateZ(10px); }
.gp-rf3 { transform: rotateY(-90deg) translateZ(10px); }
.gp-rf4 { transform: rotateY(90deg) translateZ(10px); }
.gp-rf5 { transform: rotateX(90deg) translateZ(10px); }
.gp-rf6 { transform: rotateX(-90deg) translateZ(10px); }
.hub-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}
.hub-icon { transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); font-size: 22px; line-height: 1; color: var(--accent); }
.hub-text { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.hub-text b { font-size: 15px; color: var(--text); white-space: nowrap; }
.hub-text em { font-style: normal; font-size: 12px; color: var(--muted, #8a94b8); white-space: nowrap; }
.hub-arrow { font-size: 20px; color: var(--muted, #8a94b8); transition: transform 0.2s, color 0.2s; }
.hub-card:hover .hub-arrow { transform: translateX(3px); color: var(--accent); }
</style>
