<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { api } from '../api';

// 文字冒险模式选择：独立视图页面（从首页入口跳转进入）
const { state, loadCatalogs, parseTheme, startGame } = inject('game');

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
  await loadCatalogs();
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
  <div class="adventure">
    <header class="adventure-header">
      <button class="back" @click="$emit('back')">‹ 返回首页</button>
      <h2>⚔️ 文字冒险</h2>
      <span class="hint">你的每一个选择都将改变命运</span>
    </header>

    <div class="adventure-body">
      <!-- 游戏模式 -->
      <section class="block">
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
.adventure {
  max-width: 860px;
  margin: 0 auto;
  padding: 20px 16px 60px;
}
.adventure-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.adventure-header h2 {
  margin: 0;
  font-size: 20px;
}
.adventure-header .hint {
  color: var(--text-dim);
  font-size: 12px;
}
.back {
  background: none;
  border: 1px solid var(--border, #444);
  color: var(--text, #eee);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.back:hover {
  opacity: 0.8;
}
.block {
  margin-bottom: 22px;
}
.block h2 {
  font-size: 15px;
  margin: 0 0 10px;
  color: var(--text);
}
.mode-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.mode-card {
  padding: 14px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 15px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.mode-card.active {
  border-color: var(--accent);
  background: linear-gradient(135deg, rgba(212, 161, 44, 0.12), rgba(60, 90, 160, 0.12)), var(--panel-2);
}
.theme-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s;
}
.theme-card.active {
  border-color: var(--accent);
}
.theme-name {
  font-size: 14px;
  color: var(--text);
  font-weight: 600;
}
.theme-intro {
  font-size: 12px;
  color: var(--text-dim);
}
.import {
  margin-top: 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 10px 14px;
}
.import summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-dim);
}
.import textarea {
  width: 100%;
  box-sizing: border-box;
  margin: 10px 0;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}
.import-ok {
  font-size: 12px;
  color: #3fb950;
  margin: 6px 0 0;
}
.btn {
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 14px;
  cursor: pointer;
}
.btn.primary {
  background: linear-gradient(135deg, #d4a12c, #3c5aa0);
  color: #fff;
  font-weight: 600;
}
.btn.ghost {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
}
.btn.full {
  width: 100%;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.start-box {
  display: flex;
  gap: 10px;
  margin-top: 24px;
}
.start-box input {
  flex: 1;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 10px 12px;
  font-size: 14px;
}
.hint {
  color: var(--text-dim);
}
.hint.small {
  font-size: 12px;
  margin: 8px 0 0;
}
.error {
  color: #ff7d7d;
  font-size: 13px;
  margin: 12px 0 0;
}
/* 手机端适配：头部紧凑化（标题缩小、副标题隐藏防单字换行）、卡片网格单列化 */
@media (max-width: 480px) {
  .adventure-header {
    gap: 8px;
  }
  .adventure-header h2 {
    font-size: 17px;
    white-space: nowrap;
  }
  .adventure-header .hint {
    display: none; /* 副标题在窄屏隐藏，避免单字换行 */
  }
  .back {
    padding: 5px 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .mode-list {
    grid-template-columns: repeat(2, 1fr); /* 模式卡片两列 */
  }
  .theme-list {
    grid-template-columns: 1fr; /* 题材/板子卡片单列 */
  }
  .start-box {
    flex-direction: column; /* 名字输入与开始按钮纵向堆叠 */
  }
}
</style>
