<template>
  <div class="hub">
    <div class="hub-head">
      <button class="hub-back" title="返回首页" @click="backHome"><Icon name="back" :size="16" /> <span>首页</span></button>
      <h1 class="hub-title">3D 世界</h1>
      <p class="hub-sub">实时 3D 游戏中心 · 每个游戏独立加载</p>
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
          <span class="gp-grid"></span>
          <span class="gp-cube gp-c1"></span>
          <span class="gp-cube gp-c2"></span>
          <span class="gp-cube gp-c3"></span>
          <span class="gp-slash"></span>
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
import { inject } from 'vue';

const { state } = inject('game');

// 游戏清单：数据驱动，以后加游戏只需注册一条数据
const games = [
  {
    id: 'game',
    name: '挥剑挑战',
    desc: '挥剑切割 · 面状拖尾 · 计分挑战',
    icon: 'sword',
    badge: 'LIVE 3D',
  },
];

function enterGame(id) {
  state.view = id;
}
function backHome() {
  state.view = 'home';
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
.hub-back {
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
.hub-back:hover { border-color: var(--accent); }
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
