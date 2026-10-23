<script setup>
import Icon from './Icon.vue';
import { ref, computed, onMounted, inject } from 'vue';
import { api } from '../api';

// 文字冒险模式选择：独立视图页面（从首页入口跳转进入）
const { state, loadCatalogs, parseTheme, startGame, loadSave, refreshSaves } = inject('game');
// —— 存档管理（原顶栏入口迁移至此：存档仅属于文字冒险） ——
const showSaves = ref(false);
const deletingId = ref('');
const deletingAll = ref(false);
async function deleteAllSaves() {
  if (deletingAll.value || deletingId.value) return;
  const n = state.saves.length;
  if (!n) return;
  if (!confirm(`确定清空全部 ${n} 个存档吗？此操作不可恢复，且只影响当前账号。`)) return;
  deletingAll.value = true;
  state.error = '';
  try {
    await api.deleteAllSaves();
    await refreshSaves();
  } catch (e) {
    state.error = e.message;
  } finally {
    deletingAll.value = false;
  }
}
async function deleteSave(s) {
  if (deletingId.value) return;
  if (!confirm(`确定删除存档「${s.playerName}」吗？此操作不可恢复。`)) return;
  deletingId.value = s.id;
  state.error = '';
  try {
    await api.deleteSave(s.id);
    await refreshSaves();
  } catch (e) {
    state.error = e.message;
  } finally {
    deletingId.value = '';
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
      <h2><Icon name="sword" /> 文字冒险</h2>
      <span class="hint">你的每一个选择都将改变命运</span>
      <button class="saves-btn" title="存档" @click="showSaves = true"><Icon name="save" :size="16" /> 存档</button>
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
        <p v-if="currentMode && currentMode.desc" class="mode-desc">{{ currentMode.desc }}</p>
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
        <h2>选择世界观</h2>
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
    <!-- 存档选择浮层（原顶栏入口迁移至此：存档仅属于文字冒险） -->
    <div v-if="showSaves" class="save-overlay" @click.self="showSaves = false">
      <div class="save-modal">
        <div class="save-modal-head">
          <h3>📂 继续冒险</h3>
          <button class="save-modal-close" @click="showSaves = false">✕</button>
        </div>
        <div class="save-modal-body">
          <div v-for="s in state.saves" :key="s.id" class="save-item" @click="showSaves = false; loadSave(s.id)">
            <span class="save-name">{{ s.playerName }}</span>
            <span class="save-meta">
              <em v-if="s.caseTitle">{{ s.caseTitle }}</em>
              <em v-else-if="s.themeName">{{ s.themeName }}</em>
              <template v-if="s.caseTitle || s.themeName"> · </template>
              <template v-if="s.mode !== 'detective'">Lv.{{ s.level }} · </template>
              {{ new Date(s.updatedAt).toLocaleString() }}
            </span>
            <button class="save-delete" :disabled="deletingId === s.id" @click.stop="deleteSave(s)">
              {{ deletingId === s.id ? '删除中…' : '🗑 删除' }}
            </button>
          </div>
          <button class="save-clear-all" :disabled="deletingAll" @click="deleteAllSaves">
            {{ deletingAll ? '清空中…' : `🗑 清空全部存档（${state.saves.length}）` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* —— 存档按钮与浮层（原顶栏入口迁移至此，样式合并自 App.vue 与 HomeView） —— */
.saves-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.saves-btn:hover { border-color: var(--accent); }
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
.save-modal-head h3 { margin: 0; font-size: 15px; }
.save-modal-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
}
.save-modal-body { overflow-y: auto; padding: 12px 16px; }
.save-item {
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.save-item:hover {
  border-color: var(--accent);
  background: rgba(212, 161, 44, 0.06);
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
.save-delete:hover { color: var(--danger); border-color: var(--danger); }
.save-delete:disabled { opacity: 0.6; cursor: not-allowed; }
.save-name { font-weight: 600; }
.save-meta { color: var(--text-dim); font-size: 13px; }
.save-meta em { font-style: normal; color: var(--accent-2); }
html.light .save-overlay { background: rgba(30, 38, 56, 0.35); }
.adventure {
  height: 100%;
  overflow-y: auto; /* 内部滚动：页面级滚动已锁死，内容超出视口时在此滚动 */
  -webkit-overflow-scrolling: touch; /* iOS 惯性滚动 */
  max-width: 860px;
  margin: 0 auto;
  padding: calc(var(--bar-h, 48px) + 20px) 16px 60px; /* 顶栏悬浮让位 */
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
.mode-desc {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-dim, #9aa4b2);
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
