<script setup>
import Icon from './Icon.vue';
import { ref, computed, onMounted, onBeforeUnmount, inject, Transition } from 'vue';
import { api } from '../api';
import SilkBackground from './SilkBackground.vue';

const { state, loadCatalogs, refreshSaves, parseTheme, startGame, loadSave, openDraw, openOffice, openAdventure, openChat } = inject('game');

// —— 对话框入口：点击后飞入过渡——首页缩小后退模糊淡出，对话页从输入框位置弹性放大 ——
const homeEl = ref(null);
function enterChat() {
  const home = homeEl.value;
  if (home) {
    home.classList.add('leaving'); // 首页被推远：缩小+模糊+淡出
    setTimeout(() => openChat(), 260); // 过渡中段切换视图，衔接无缝
  } else {
    openChat();
  }
}

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
      /* 渐变文字发光：text-shadow 在透明填充文字上呈金色光晕（filter 会破坏背景裁剪，不可用） */
      inner.style.textShadow = force > 0.04 ? `0 0 ${18 * force}px rgba(247, 220, 154, ${0.9 * force})` : '';
    });
  });
}
function onTitleLeave() {
  const el = titleRef.value;
  if (!el) return;
  el.querySelectorAll('.title-char-inner').forEach((inner) => {
    inner.style.transform = '';
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
  <div class="home" ref="homeEl">
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

      <!-- AI 助手对话框主入口：点击飞入对话页 -->
      <div class="chat-entry" style="animation-delay: 0.43s" role="button" tabindex="0" @click="enterChat()" @keydown.enter="enterChat()">
        <span class="chat-entry-icon"><Icon name="sparkle" :size="20" /></span>
        <span class="chat-entry-text">有什么可以帮您？</span>
        <span class="chat-entry-send"><Icon name="send" :size="16" /></span>
      </div>

      <!-- 双入口并列：绘图工作台 / 文字冒险 -->
      <div class="play-grid">
        <div class="play-entry" style="animation-delay: 0.55s" @mousemove="onEntryMove" @mouseleave="onEntryLeave" @click="openDraw()" role="button" tabindex="0" @keydown.enter="openDraw()">
          <span class="play-icon"><Icon name="brush" :size="22" /></span>
          <span class="play-text">
            <b>绘图工作台</b>
            <em>文生图 · 图片编辑 · 自由配置模型与参数</em>
          </span>
          <span class="play-arrow">›</span>
        </div>
        <div class="play-entry" style="animation-delay: 0.67s" @mousemove="onEntryMove" @mouseleave="onEntryLeave" @click="openOffice()" role="button" tabindex="0" @keydown.enter="openOffice()">
          <span class="play-icon"><Icon name="chart" :size="22" /></span>
          <span class="play-text">
            <b>办公助手</b>
            <em>信息图 · 简历图 · 一键生成专业视觉内容</em>
          </span>
          <span class="play-arrow">›</span>
        </div>
        <div class="play-entry" style="animation-delay: 0.79s" @mousemove="onEntryMove" @mouseleave="onEntryLeave" @click="openAdventure()" role="button" tabindex="0" @keydown.enter="openAdventure()">
          <span class="play-icon"><Icon name="sword" :size="22" /></span>
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
  padding-top: var(--bar-h, 48px); /* 顶栏悬浮让位：内容滚动时从毛玻璃后穿过 */
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

/* 标题：衬线书法风 + 金色渐变流光（A+C 组合）
   渐变裁剪放在最内层字符上——外层入场动画的 filter 会使子元素脱离背景裁剪渲染导致文字消失 */
.title {
  font-family: 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif;
  font-size: 46px;
  font-weight: 700;
  letter-spacing: 8px;
  text-align: center;
  margin: 0;
  /* 深色底不需要投影：黑色 text-shadow 在透明填充文字上会沿字形扩散染暗边缘（发黑感根因） */
  text-shadow: none;
}
/* 浅色模式：亮金字在白底上对比不足，保留轻投影保证可读 */
:global(html.light) .title {
  text-shadow: 0 1px 4px rgba(120, 90, 20, 0.35);
}
/* 流光：单向匀速无限循环——渐变首尾同色天然周期，200% 尺寸下位移一个周期恰好无缝衔接，
   高光带永远朝同一方向流动，到边缘后从另一侧自然续上，无往返割裂感 */
@keyframes title-shine {
  from { background-position: 200% 0; }
  to { background-position: 0% 0; }
}
.title-char {
  display: inline-block;
  animation: title-reveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
/* 翻澜内层：入场动画在外层，动态变形在内层，互不冲突；渐变流光在此层 */
.title-char-inner {
  display: inline-block;
  background: linear-gradient(105deg, #b8860b 0%, #d4a12c 18%, #f7dc9a 38%, #ffe9b0 50%, #f7dc9a 62%, #d4a12c 82%, #b8860b 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: title-shine 4.5s linear infinite;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), text-shadow 0.3s;
  will-change: transform;
}
@keyframes title-reveal {
  0% { opacity: 0; transform: translateY(14px) scale(0.8); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
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
/* —— AI 助手对话框主入口：复用入口卡片流光边框技术，视觉权重最高 —— */
.chat-entry {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 18px;
  margin-bottom: 22px;
  border: 1px solid rgba(212, 161, 44, 0.22);
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(212, 161, 44, 0.1), rgba(60, 90, 160, 0.1)), var(--panel-2);
  cursor: pointer;
  animation: entry-in 0.55s ease both;
  box-shadow: 0 0 22px rgba(212, 161, 44, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: border-color 0.2s, transform 0.18s ease-out, box-shadow 0.2s;
}
.chat-entry:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.4), 0 0 34px color-mix(in srgb, var(--accent-2) 24%, transparent);
}
.chat-entry:hover .chat-entry-send {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #1a1303;
  transform: scale(1.08);
}
.chat-entry-icon {
  color: var(--accent);
  display: inline-flex;
}
.chat-entry-text {
  flex: 1;
  color: var(--text-dim);
  font-size: 15px;
}
.chat-entry-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  transition: background 0.2s, color 0.2s, transform 0.18s ease-out;
}
/* 对话框流光边框：常态即旋转（主入口常亮，区别于卡片的 hover 触发） */
.chat-entry::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 15px;
  padding: 1.5px;
  background: conic-gradient(from var(--ang, 0deg), transparent 0%, var(--accent-2) 14%, transparent 32%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0.55;
  pointer-events: none;
  animation: border-spin 3.2s linear infinite;
}
.chat-entry:hover::before { opacity: 1; }
/* —— 飞入过渡：首页被推远（缩小+模糊+淡出），对话页从输入框位置放大展开 —— */
.home.leaving {
  animation: home-leave 0.5s cubic-bezier(0.5, 0, 0.75, 0) both;
  pointer-events: none;
}
@keyframes home-leave {
  to {
    opacity: 0;
    transform: scale(0.88);
    filter: blur(8px);
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
    font-size: 32px;
    letter-spacing: 4px;
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
