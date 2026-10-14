<script setup>
import { ref, computed, onMounted, inject, Transition } from 'vue';
import { api } from '../api';

const { state, loadCatalogs, refreshSaves, parseTheme, startGame, loadSave, openDraw } = inject('game');

const playerName = ref('');
const adventureSection = ref(null);
// 文字冒险入口：平滑滚动到表单区并短暂高亮
function scrollToAdventure() {
  const el = adventureSection.value;
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('block-flash');
  setTimeout(() => el.classList.remove('block-flash'), 1600);
}
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
    <div class="home-card">
      <h1 class="title">
        <span
          v-for="(ch, i) in '万象工坊'"
          :key="i"
          class="title-char"
          :style="{ animationDelay: (0.15 + i * 0.12) + 's' }"
        >{{ ch }}</span>
      </h1>
      <p class="subtitle">AI 驱动的创作世界 · Powered by AI</p>
      <div class="title-divider" aria-hidden="true"></div>

      <!-- 双入口并列：绘图工作台 / 文字冒险 -->
      <div class="play-grid">
        <div class="play-entry" @click="openDraw()" role="button" tabindex="0" @keydown.enter="openDraw()">
          <span class="play-icon">🎨</span>
          <span class="play-text">
            <b>绘图工作台</b>
            <em>文生图 · 图片编辑 · 自由配置模型与参数</em>
          </span>
          <span class="play-arrow">›</span>
        </div>
        <div class="play-entry" @click="scrollToAdventure" role="button" tabindex="0" @keydown.enter="scrollToAdventure">
          <span class="play-icon">⚔️</span>
          <span class="play-text">
            <b>文字冒险</b>
            <em>推理杀 · 探案 · 狼人杀 · 大世界</em>
          </span>
          <span class="play-arrow">›</span>
        </div>
      </div>

      <!-- 文字冒险区块：专属标语 -->
      <p class="mode-slogan">⚔️ 文字冒险 · 你的每一个选择都将改变命运</p>

      <!-- 游戏模式 -->
      <section class="block" ref="adventureSection">
        <h2>选择模式</h2>
        <div class="mode-list">
          <button
            v-for="m in state.modes"
            :key="m.id"
            class="mode-card"
            :class="{ active: modeId === m.id }"
            @click="pickMode(m.id)"
          >
            {{ m.name }}
          </button>
        </div>
      </section>

      <!-- 板子（推理杀模式） -->
      <section v-if="needBoard" class="block">
        <h2>选择板子</h2>
        <div class="theme-list">
          <button
            v-for="b in BOARDS"
            :key="b.id"
            class="theme-card"
            :class="{ active: boardId === b.id }"
            @click="pickBoard(b.id)"
          >
            <span class="theme-name">{{ b.name }}</span>
            <span class="theme-intro">{{ b.intro }}</span>
          </button>
        </div>
      </section>
      <!-- 案件题材（探案模式） -->
      <section v-if="needGenre" class="block">
        <h2>选择案件题材</h2>
        <div class="theme-list">
          <button
            v-for="g in state.genres"
            :key="g.id"
            class="theme-card"
            :class="{ active: genreId === g.id }"
            @click="pickGenre(g.id)"
          >
            <span class="theme-name">{{ g.name }}</span>
            <span class="theme-intro">{{ g.hint }}</span>
          </button>
        </div>
      </section>

      <!-- 世界观 -->
      <section v-if="needTheme" class="block">
        <h2>选择世界</h2>
        <div class="theme-list">
          <button
            v-for="t in state.themes"
            :key="t.id"
            class="theme-card"
            :class="{ active: !customTheme && themeId === t.id }"
            @click="pickTheme(t.id)"
          >
            <span class="theme-name">{{ t.name }}</span>
            <span class="theme-intro">{{ t.intro }}</span>
          </button>
        </div>

        <details class="import">
          <summary>导入自定义世界观（粘贴文本，由 AI 解析）</summary>
          <textarea
            v-model="importText"
            rows="4"
            maxlength="4000"
            placeholder="粘贴你的世界观设定文本，例如时代背景、是否存在战斗、货币、装备概念等…"
          ></textarea>
          <button class="btn ghost full" :disabled="importing || !importText.trim()" @click="doImport">
            {{ importing ? '解析中…' : '解析并选用' }}
          </button>
          <p v-if="customTheme" class="import-ok">已采用自定义世界：{{ customTheme.name }}</p>
        </details>
      </section>

      <div class="start-box">
        <input
          v-model="playerName"
          type="text"
          maxlength="20"
          :placeholder="`给自己起个名字（可留空，默认「${defaultName}」）`"
          @keyup.enter="start"
        />
        <button class="btn primary" :disabled="state.loading || !canStart" @click="start">
          <template v-if="state.loading">{{ needGenre ? '正在设计案件…' : '进入世界…' }}</template>
          <template v-else>{{ needGenre ? '开始查案' : '开始新冒险' }}</template>
        </button>
      </div>
      <p class="hint small">名字可留空：不填将直接以「{{ defaultName }}」的身份开始游戏</p>
      <p v-if="needGenre" class="hint small">探案模式会由 AI 即时设计一桩命案，请先选择题材</p>

      <p v-if="state.error" class="error">{{ state.error }}</p>
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

.home-card {
  width: min(520px, 92vw);
  margin: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 36px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.title {
  font-size: 38px;
  letter-spacing: 6px;
  text-align: center;
  margin: 0;
  /* 渐变金色文字（拉大对比保证清晰）；仅用 1px 轻投影做立体感——大模糊光晕会让文字发虚 */
  background: linear-gradient(180deg, #faf0d2 0%, var(--accent-2) 50%, #9a6f1f 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.title-char {
  display: inline-block;
  animation: title-reveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
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
/* 双入口并列网格：绘图工作台 / 文字冒险 */
.play-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 22px;
}
/* 玩法入口卡片 */
.play-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(212, 161, 44, 0.08), rgba(60, 90, 160, 0.08)), var(--panel-2);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.play-entry:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.play-icon {
  font-size: 26px;
  flex-shrink: 0;
}
.play-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.play-text b {
  font-size: 15px;
  color: var(--text);
}
.play-text em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-dim);
}
.play-arrow {
  margin-left: auto;
  font-size: 20px;
  color: var(--text-dim);
  flex-shrink: 0;
}
/* 文字冒险表单区：入口点击后的短暂高亮 */
.block-flash {
  animation: block-glow 1.6s ease;
}
@keyframes block-glow {
  0%, 100% { box-shadow: none; }
  25% { box-shadow: 0 0 0 3px rgba(212, 161, 44, 0.35); border-radius: 10px; }
}
/* 手机端：双入口纵向堆叠 */
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
    padding: 20px 16px;
    margin: 16px auto;
    width: min(520px, 94vw);
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
