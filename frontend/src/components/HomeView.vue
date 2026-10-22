<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject, Transition } from 'vue';
import { api } from '../api';
import SilkBackground from './SilkBackground.vue';

const { state, loadCatalogs, refreshSaves, parseTheme, startGame, loadSave, openDraw, openOffice, openAdventure } = inject('game');

const playerName = ref('');
const modeId = ref('deduction');
const themeId = ref('');
const customTheme = ref(null); // 由纯文本导入生成的世界观
const importText = ref('');
const importing = ref(false);
const genreId = ref(''); // 探案模式：案件题材
const boardId = ref('standard'); // 推理杀：板子（standard 七人标准 | advanced 十人进阶）
const needBoard = computed(() => modeId.value === 'deduction');
// 各模式在名称为空时服务端使用的默认名（与后端 newGame 逻辑保持一致）
const DEFAULT_NAMES = {
  deduction: '法官',
  wolf: '村民甲',
  detective: '无名侦探',
  world: '无名冒险者',
};
const defaultName = computed(() => DEFAULT_NAMES[modeId.value] || '无名冒险者');
const BOARDS = [
  { id: 'standard', name: '七人标准', intro: '4 好人 + 1 中立 + 2 坏人，经典配置' },
  { id: 'advanced', name: '十人进阶', intro: '5 好人 + 2 中立 + 3 坏人，新增观者/邮差/行者/庸医/间谍/小丑/术士' },
];

const currentMode = computed(() => state.modes.find((m) => m.id === modeId.value) || null);
const needTheme = computed(() => !!currentMode.value?.needsTheme);
const needGenre = computed(() => !!currentMode.value?.needsGenre);

onMounted(async () => {
  await Promise.all([loadCatalogs(), refreshSaves()]);
  if (!themeId.value && state.themes.length) themeId.value = state.themes[0].id;
});

// —— 标题翻澜：鼠标靠近时字符波浪式起伏 + 提亮发光（对标 SenseNova U1 Pro 标题效果） ——
const titleRef = ref(null);
let titleRaf = 0;
function onTitleMove(e) {
  if (titleRaf) return;
  titleRaf = requestAnimationFrame(() => {
    titleRaf = 0;
    const el = titleRef.value;
    if (!el) return;
    el.querySelectorAll('.title-char-inner').forEach((inner) => {
      const rc = inner.getBoundingClientRect();
      const dx = e.clientX - (rc.left + rc.width / 2);
      const dy = e.clientY - (rc.top + rc.height / 2);
      const force = Math.max(0, 1 - Math.hypot(dx, dy) / 150); // 150px 影响半径
      const f2 = force * force;
      inner.style.transform = `translateY(${-f2 * 16}px) rotate(${(dx > 0 ? -1 : 1) * f2 * 7}deg) scale(${1 + f2 * 0.14})`;
      inner.style.color = force > 0.04 ? '#f7dc9a' : '';
      inner.style.textShadow = force > 0.04 ? `0 0 ${20 * force}px rgba(232, 193, 90, ${0.85 * force})` : '';
    });
  });
}
function onTitleLeave() {
  const el = titleRef.value;
  if (!el) return;
  el.querySelectorAll('.title-char-inner').forEach((inner) => {
    inner.style.transform = '';
    inner.style.color = '';
    inner.style.textShadow = '';
  });
}

// —— 入口卡片 3D 倾斜：随鼠标位置立体翻转 + 光斑跟随 ——
function onEntryMove(e) {
  const el = e.currentTarget;
  const rc = el.getBoundingClientRect();
  const px = (e.clientX - rc.left) / rc.width - 0.5;
  const py = (e.clientY - rc.top) / rc.height - 0.5;
  el.style.transform = `perspective(560px) rotateX(${(-py * 14).toFixed(2)}deg) rotateY(${(px * 16).toFixed(2)}deg) translateY(-4px) scale(1.03)`;
  el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
  el.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
}
function onEntryLeave(e) {
  e.currentTarget.style.transform = '';
}

onBeforeUnmount(() => {
  if (titleRaf) cancelAnimationFrame(titleRaf);
});

function pickMode(id) {
  modeId.value = id;
  state.error = '';
}

function pickTheme(id) {
  themeId.value = id;
  customTheme.value = null;
  state.error = '';
}

function pickGenre(id) {
  genreId.value = id;
  state.error = '';
}
function pickBoard(id) {
  boardId.value = id;
  state.error = '';
}

async function doImport() {
  if (!importText.value.trim() || importing.value) return;
  importing.value = true;
  state.error = '';
  try {
    customTheme.value = await parseTheme(importText.value);
    themeId.value = '';
  } catch (e) {
    state.error = e.message;
  } finally {
    importing.value = false;
  }
}

function start() {
  startGame({
    playerName: playerName.value.trim(),
    mode: modeId.value,
    theme: customTheme.value || themeId.value,
    genre: genreId.value,
    board: needBoard.value ? boardId.value : '',
  });
}

const canStart = computed(() => {
  // 名称可选：留空时由服务端使用各模式默认名（法官/村民甲/无名侦探/无名冒险者）
  if (needGenre.value && !genreId.value) return false;
  return true;
});
</script>

<template>
  <div class="home">
    <SilkBackground />
    <div class="home-card">
      <h1 class="title" ref="titleRef" @mousemove="onTitleMove" @mouseleave="onTitleLeave">
        <span
          v-for="(ch, i) in '万象工坊'"
          :key="i"
          class="title-char"
          :style="{ animationDelay: (0.15 + i * 0.12) + 's' }"
        ><span class="title-char-inner">{{ ch }}</span></span>
      </h1>
      <p class="subtitle">AI 驱动的创作世界 · Powered by AI</p>
      <div class="title-divider" aria-hidden="true"></div>

      <!-- 双入口并列：绘图工作台 / 文字冒险 -->
      <div class="play-grid">
        <div class="play-entry" style="animation-delay: 0.55s" @mousemove="onEntryMove" @mouseleave="onEntryLeave" @click="openDraw()" role="button" tabindex="0" @keydown.enter="openDraw()">
          <span class="play-icon">🎨</span>
          <span class="play-text">
            <b>绘图工作台</b>
            <em>文生图 · 图片编辑 · 自由配置模型与参数</em>
          </span>
          <span class="play-arrow">›</span>
        </div>
        <div class="play-entry" style="animation-delay: 0.67s" @mousemove="onEntryMove" @mouseleave="onEntryLeave" @click="openOffice()" role="button" tabindex="0" @keydown.enter="openOffice()">
          <span class="play-icon">📊</span>
          <span class="play-text">
            <b>办公助手</b>
            <em>信息图 · 简历图 · 一键生成专业视觉内容</em>
          </span>
          <span class="play-arrow">›</span>
        </div>
        <div class="play-entry" style="animation-delay: 0.79s" @mousemove="onEntryMove" @mouseleave="onEntryLeave" @click="openAdventure()" role="button" tabindex="0" @keydown.enter="openAdventure()">
          <span class="play-icon">⚔️</span>
          <span class="play-text">
            <b>文字冒险</b>
            <em>推理杀 · 探案 · 狼人杀 · 大世界</em>
          </span>
          <span class="play-arrow">›</span>
        </div>
      </div>


    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  display: flex;
  justify-content: center;
  overflow-y: auto;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(212, 161, 44, 0.12), transparent 50%),
    radial-gradient(ellipse at 70% 80%, rgba(60, 90, 160, 0.15), transparent 50%),
    var(--bg);
}

/* hero 布局：无容器背景，内容直接悬浮在流动绸缎上（对标 SenseNova / ReactBits hero 设计） */
.home-card {
  position: relative;
  z-index: 1;
  width: min(560px, 92vw);
  margin: auto;
  padding: 48px 12px;
  background: none;
  border: none;
  box-shadow: none;
}

.title {
  font-size: 38px;
  letter-spacing: 6px;
  text-align: center;
  margin: 0;
  /* 实心金色文字：渐变透明文字多次反馈看不清，改用纯色+轻投影保证绝对清晰 */
  color: #e8c15a;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
}
.title-char {
  display: inline-block;
  animation: title-reveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
/* 翻澜内层：入场动画在外层，动态变形在内层，互不冲突 */
.title-char-inner {
  display: inline-block;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), color 0.3s, text-shadow 0.3s;
  will-change: transform;
}
@keyframes title-reveal {
  0% { opacity: 0; transform: translateY(14px) scale(0.8); filter: blur(4px); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}

.subtitle {
  color: var(--text);
  text-align: center;
  margin: 14px 0 0;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 2px;
}
/* 文字冒险区块专属标语 */
.mode-slogan {
  color: var(--accent-2);
  text-align: center;
  font-size: 13px;
  letter-spacing: 1px;
  margin: 0 0 14px;
}
/* 标题区装饰分隔线：金色渐变细线，两端淡出 */
/* 三入口等宽网格：绘图工作台 / 文字冒险 / 办公助手 */
.play-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 22px;
}
/* 玩法入口卡片：竖版布局（图标居顶、标题居中），三卡等宽对称 */
.play-entry {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 20px 14px 16px;
  border: 1px solid rgba(212, 161, 44, 0.18);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(212, 161, 44, 0.08), rgba(60, 90, 160, 0.08)), var(--panel-2);
  cursor: pointer;
  /* 错落入场：透明度+模糊淡入（不用 transform，避免与 3D 倾斜冲突） */
  animation: entry-in 0.55s ease both;
  /* 常态微光：静态即可感知的轮廓光感 */
  box-shadow: 0 0 18px rgba(212, 161, 44, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  transition: border-color 0.2s, transform 0.18s ease-out, box-shadow 0.2s;
  transform-style: preserve-3d;
}
@keyframes entry-in {
  from { opacity: 0; filter: blur(4px); }
  to { opacity: 1; filter: blur(0); }
}
/* 鼠标位置高光：随光标移动的径向光斑 */
.play-entry::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(200px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--accent-2) 22%, transparent), transparent 65%);
  opacity: 0;
  transition: opacity 0.25s;
  pointer-events: none;
}
.play-entry:hover::after { opacity: 1; }
/* 流光边框：hover 时一圈旋转的渐变光带 */
.play-entry::before {
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
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  animation: border-spin 2.8s linear infinite;
}
@property --ang {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
@keyframes border-spin { to { --ang: 360deg; } }
.play-entry:hover::before { opacity: 1; }
.play-entry:hover {
  border-color: var(--accent);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45), 0 0 34px color-mix(in srgb, var(--accent-2) 22%, transparent);
}
.play-entry:hover .play-icon {
  transform: scale(1.12);
}
.play-icon {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.play-icon {
  font-size: 34px;
  line-height: 1;
}
.play-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.play-text b {
  font-size: 15px;
  color: var(--text);
  white-space: nowrap;
}
.play-text em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-dim);
}
.play-arrow {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 16px;
  color: var(--text-dim);
}
/* 文字冒险表单展开过渡：淡入 + 上滑 */
.adventure-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.adventure-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.adventure-enter-from,
.adventure-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.adventure-panel {
  margin-top: 4px;
}
/* 入口卡片展开态：金色边框提示 */
.play-entry.open {
  border-color: var(--accent);
}
/* 箭头随展开旋转 90 度 */
.play-arrow {
  transition: transform 0.25s ease;
}
.play-arrow.open {
  transform: rotate(90deg);
}
/* 手机端：三入口纵向堆叠 */
@media (max-width: 480px) {
  .play-grid {
    grid-template-columns: 1fr;
  }
}
.title-divider {
  height: 1px;
  margin: 18px auto 26px;
  width: 72%;
  background: linear-gradient(90deg, transparent, rgba(212, 161, 44, 0.55), transparent);
}

.block {
  margin-bottom: 20px;
}

.block h2 {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 10px;
}

.mode-list,
.theme-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mode-card {
  padding: 10px 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 15px;
  transition: all 0.15s;
}

.mode-card.active,
.theme-card.active {
  border-color: var(--accent);
  color: var(--accent-2);
  background: rgba(212, 161, 44, 0.1);
}

.theme-card {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  transition: all 0.15s;
}

.theme-name {
  font-weight: 600;
}

.theme-intro {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}

.import {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-dim);
}

.import summary {
  cursor: pointer;
  padding: 6px 0;
}

.import textarea {
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  outline: none;
}

.import textarea:focus {
  border-color: var(--accent);
}

.import-ok {
  color: var(--accent-2);
  font-size: 13px;
  margin-top: 8px;
}

.btn {
  padding: 12px 22px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  transition: opacity 0.15s;
}

.btn.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #1a1303;
}

.btn.ghost {
  padding: 8px 12px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  font-size: 13px;
}

.btn.full {
  width: 100%;
  margin-top: 8px;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.start-box {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.start-box input {
  flex: 1;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  outline: none;
  font-size: 15px;
}

.start-box input:focus {
  border-color: var(--accent);
}

.error {
  color: var(--danger);
  margin-top: 12px;
  font-size: 14px;
}

.hint {
  color: var(--text-dim);
  text-align: center;
  margin-top: 24px;
  font-size: 14px;
}

.hint.small {
  margin-top: 10px;
  font-size: 12px;
}

/* 存档入口按钮（替代原卡片内铺开的存档列表） */
.save-entry {
  margin-top: 28px;
  border-top: 1px solid var(--border);
  padding-top: 20px;
  text-align: center;
}
.save-btn {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
}
.save-btn:hover {
  border-color: var(--accent);
  color: var(--accent-2);
}
/* 存档选择浮层 */
.save-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}
.save-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  max-width: 520px;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.save-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.save-modal-head h3 {
  margin: 0;
  font-size: 15px;
}
.save-modal-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
}
.save-modal-body {
  overflow-y: auto;
  padding: 12px 16px;
}
.save-modal-body .save-item {
  margin-bottom: 8px;
}
.save-clear-all {
  width: 100%;
  padding: 10px 14px;
  margin-top: 6px;
  border: 1px solid rgba(248, 81, 73, 0.4);
  border-radius: 8px;
  background: rgba(248, 81, 73, 0.08);
  color: #f85149;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.save-clear-all:hover:not(:disabled) {
  border-color: #f85149;
  background: rgba(248, 81, 73, 0.16);
}
.save-clear-all:disabled {
  opacity: 0.5;
  cursor: default;
}
/* 浮层展开/收回动画（与推理杀弹窗一致） */
.ovl-enter-active {
  transition: opacity 0.2s ease;
}
.ovl-enter-active .save-modal {
  animation: save-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ovl-leave-active {
  transition: opacity 0.22s ease;
}
.ovl-leave-active .save-modal {
  transition: transform 0.22s ease, opacity 0.22s ease;
  transform: scale(0.85) translateY(14px);
  opacity: 0;
}
.ovl-enter-from,
.ovl-leave-to {
  opacity: 0;
}
@keyframes save-pop {
  from { transform: scale(0.7); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.save-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.save-item:hover {
  border-color: var(--accent);
}

.save-delete {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  min-height: 32px;
}

.save-delete:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.save-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.save-name {
  font-weight: 600;
}

.save-meta {
  color: var(--text-dim);
  font-size: 13px;
}

.save-meta em {
  font-style: normal;
  color: var(--accent-2);
}
/* 移动端适配：收紧间距、触控目标 ≥44px、输入框 16px 防 iOS 聚焦自动放大 */
@media (max-width: 768px) {
  .home-card {
    padding: 24px 8px;
    margin: 12px auto;
    width: min(560px, 94vw);
  }
  .title {
    font-size: 26px;
    letter-spacing: 1px;
  }
  .subtitle {
    margin: 8px 0 18px;
  }
  .block {
    margin-bottom: 16px;
  }
  .mode-card {
    padding: 12px 16px;
    min-height: 44px;
  }
  .theme-card {
    padding: 12px 14px;
    min-height: 44px;
  }
  .home-card input {
    font-size: 16px;
    min-height: 44px;
  }
}
</style>
