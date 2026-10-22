<script setup>
// 终局结算弹窗（从 DeductionView 拆出）：胜负结算 + 谢幕演出 + 逐夜回顾入口。
// 状态通过 props 传入，事件通过 emit 回传——纯展示组件，不含业务逻辑。
const props = defineProps({
  show: { type: Boolean, default: false },
  gameOver: { type: Boolean, default: false },
  winner: { type: String, default: '' },
  roles: { type: Array, default: null },
  endingArt: { type: String, default: '' },
  portraits: { type: Object, default: () => ({}) },
  portraitLoading: { type: Object, default: () => ({}) },
  hasNightLogs: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'load-portrait', 'review', 'restart']);

function roleClass(role) {
  if (['狼人', '帮凶', '酒鬼', '小丑', '术士'].includes(role)) return 'role-evil';
  if (['赌徒', '小偷', '庸医', '间谍'].includes(role)) return 'role-neutral';
  return 'role-good';
}
</script>

<template>
  <Transition name="ovl">
    <div v-if="show && gameOver" class="review-overlay end-modal-overlay" @click.self="emit('close')">
      <div class="review-modal end-modal">
        <div class="end-modal-glow" aria-hidden="true"></div>
        <img v-if="endingArt" :src="endingArt" class="end-art" alt="本局终局海报" />
        <div class="end-modal-icon" :class="winner === 'good' ? 'win' : 'lose'">{{ winner === 'good' ? '🌅' : '🐺' }}</div>
        <h3 class="end-modal-title">
          <span
            v-for="(ch, i) in (winner === 'good' ? '狼人全部落网，好人获胜！' : '狼人潜伏到最后，好人失败…')"
            :key="i"
            class="end-title-char"
            :style="{ animationDelay: (0.8 + i * 0.08) + 's' }"
          >{{ ch }}</span>
        </h3>
        <!-- 谢幕演出：角色卡片依次滑入排列成终局阵容（胜利时） -->
        <div v-if="roles" class="end-curtain-call" :class="winner === 'good' ? 'win' : 'lose'">
          <div
            v-for="(r, i) in roles"
            :key="r.name"
            class="curtain-card"
            :style="{ animationDelay: (1.6 + i * 0.22) + 's' }"
            @click="emit('load-portrait', r.name)"
          >
            <img v-if="portraits[r.name]" :src="portraits[r.name]" class="curtain-portrait" :alt="r.name + ' 立绘'" />
            <span v-else class="curtain-badge" :class="roleClass(r.roleBackup || r.role)">{{ portraitLoading[r.name] ? '…' : r.name.slice(0, 1) }}</span>
            <span class="curtain-name">{{ r.name }}</span>
            <b :class="roleClass(r.roleBackup || r.role)">{{ r.roleBackup || r.role }}</b>
          </div>
        </div>
        <div class="end-modal-actions">
          <button v-if="hasNightLogs" class="btn review-btn" @click="emit('review')">📜 逐夜行动回顾</button>
          <button class="btn primary" @click="emit('restart')">🔄 再开一局</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* —— 以下样式自 DeductionView 原样搬运（scoped 隔离需各自持有） —— */
.review-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
  padding: 16px;
}
.review-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  max-width: 380px;
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  padding: 20px;
}
.review-btn {
  margin-top: 10px;
}
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #1b1f24;
  font-weight: 600;
}
.ovl-enter-active {
  transition: opacity 0.2s ease;
}
.ovl-enter-active .review-modal {
  animation: evt-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ovl-leave-active {
  transition: opacity 0.22s ease;
}
.ovl-leave-active .review-modal {
  transition: transform 0.22s ease, opacity 0.22s ease;
  transform: scale(0.85) translateY(14px);
  opacity: 0;
}
.ovl-enter-from,
.ovl-leave-to {
  opacity: 0;
}
@keyframes evt-pop {
  from { transform: scale(0.7); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
/* 终局结算弹窗 */
.end-modal {
  max-width: 380px;
  text-align: center;
  padding: 26px 22px 22px;
  animation: evt-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.end-modal {
  position: relative;
  overflow-x: hidden;
  max-height: 88vh;
  overflow-y: auto;
  /* 隐藏滚动条：卡片入场动画期间内容高度变化会让滚动条时隐时现 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.end-modal::-webkit-scrollbar {
  display: none;
}
.end-modal-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 50% 30%, rgba(212, 161, 44, 0.22), transparent 60%);
  animation: glow-pulse 3s ease-in-out infinite;
}
@keyframes glow-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.end-modal-icon {
  font-size: 44px;
  line-height: 1;
  margin-bottom: 10px;
}
.end-modal-icon.win {
  animation: sun-rise 1.2s ease-out both;
}
.end-modal-icon.lose {
  animation: wolf-emerge 1.2s ease-out both;
}
@keyframes sun-rise {
  0% { transform: translateY(22px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes wolf-emerge {
  0% { transform: scale(0.6); opacity: 0; filter: blur(6px); }
  100% { transform: scale(1); opacity: 1; filter: blur(0); }
}
.end-art {
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  border-radius: 10px;
  margin-bottom: 10px;
  position: relative;
  z-index: 2;
  animation: art-reveal 1.2s ease 0.6s both;
}
@keyframes art-reveal {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.end-curtain-call {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 12px 0 4px;
  position: relative;
  z-index: 2;
}
.curtain-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  font-size: 11px;
  cursor: pointer;
  animation: curtain-slide 0.5s ease both;
  animation-delay: inherit;
}
.end-curtain-call.win .curtain-card:nth-child(odd) {
  --slide-from: -60px;
}
.end-curtain-call.win .curtain-card:nth-child(even) {
  --slide-from: 60px;
}
@keyframes curtain-slide {
  0% { opacity: 0; transform: translateX(var(--slide-from, 0)) translateY(10px); }
  100% { opacity: 1; transform: translateX(0) translateY(0); }
}
.curtain-name {
  color: var(--text);
  font-size: 11px;
}
.curtain-badge {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: #131c3a;
  margin-bottom: 4px;
}
.curtain-portrait {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 4px;
  animation: art-reveal 0.8s ease both;
}
.end-modal.lose {
  overflow: hidden;
}
.end-modal.lose::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(120, 30, 30, 0.35));
  animation: fog-seep 2.2s ease 0.8s forwards;
  opacity: 0;
}
@keyframes fog-seep {
  from { opacity: 0; }
  to { opacity: 1; }
}
.end-title-char {
  display: inline-block;
  animation: char-reveal 0.4s ease both;
}
@keyframes char-reveal {
  0% { opacity: 0; transform: translateY(8px) scale(0.85); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.end-modal-title {
  margin: 0 0 8px;
  font-size: 16px;
}
.end-modal-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 14px;
  position: relative;
  z-index: 2;
}
.end-modal-actions .review-btn {
  margin-top: 0;
}
.end-modal-actions .review-btn:hover {
  border-color: var(--accent);
  color: var(--accent-2);
}
/* 角色阵营着色（谢幕卡片身份） */
.role-good { color: #58a6ff; }
.role-neutral { color: #d29922; }
.role-evil { color: #f85149; }
</style>
