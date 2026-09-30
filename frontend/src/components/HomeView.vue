<script setup>
import { ref, computed, onMounted, inject } from 'vue';

const { state, loadCatalogs, refreshSaves, parseTheme, startGame, loadSave } = inject('game');

const playerName = ref('');
const modeId = ref('world');
const themeId = ref('');
const customTheme = ref(null); // 由纯文本导入生成的世界观
const importText = ref('');
const importing = ref(false);
const genreId = ref(''); // 探案模式：案件题材

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
  });
}

const canStart = computed(() => {
  if (!playerName.value.trim()) return false;
  if (needGenre.value && !genreId.value) return false;
  return true;
});
</script>

<template>
  <div class="home">
    <div class="home-card">
      <h1 class="title">⚔️ 文字冒险</h1>
      <p class="subtitle">AI 驱动的文字冒险世界 · 你的每一个选择都将改变命运</p>

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
          :placeholder="needGenre ? '输入你的侦探名字' : '输入你的名字'"
          @keyup.enter="start"
        />
        <button class="btn primary" :disabled="state.loading || !canStart" @click="start">
          <template v-if="state.loading">{{ needGenre ? '正在设计案件…' : '进入世界…' }}</template>
          <template v-else>{{ needGenre ? '开始查案' : '开始新冒险' }}</template>
        </button>
      </div>
      <p v-if="needGenre" class="hint small">探案模式会由 AI 即时设计一桩命案，请先选择题材</p>

      <p v-if="state.error" class="error">{{ state.error }}</p>

      <div v-if="state.saves.length" class="save-list">
        <h2>继续冒险</h2>
        <div v-for="s in state.saves" :key="s.id" class="save-item" @click="loadSave(s.id)">
          <span class="save-name">{{ s.playerName }}</span>
          <span class="save-meta">
            <em v-if="s.caseTitle">{{ s.caseTitle }}</em>
            <em v-else-if="s.themeName">{{ s.themeName }}</em>
            <template v-if="s.caseTitle || s.themeName"> · </template>
            <template v-if="s.mode !== 'detective'">Lv.{{ s.level }} · </template>
            {{ new Date(s.updatedAt).toLocaleString() }}
          </span>
        </div>
      </div>

      <p v-else class="hint">尚无存档，从第一场冒险开始吧</p>
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
  font-size: 34px;
  color: var(--accent-2);
  letter-spacing: 2px;
  text-align: center;
}

.subtitle {
  color: var(--text-dim);
  text-align: center;
  margin: 10px 0 24px;
  font-size: 14px;
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

.save-list {
  margin-top: 28px;
  border-top: 1px solid var(--border);
  padding-top: 20px;
}

.save-list h2 {
  font-size: 15px;
  color: var(--text-dim);
  margin-bottom: 12px;
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
</style>
