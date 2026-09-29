<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue';

// ---------- 状态 ----------
const view = ref('home'); // home | game
const player = ref(null);
const history = ref([]); // { role, content }
const gameId = ref('');
const saves = ref([]);
const input = ref('');
const loading = ref(false);
const error = ref('');
const gameOver = ref(false);
const inBattle = ref(false);
const lastEffects = ref([]);

const messagesEl = ref(null);

// ---------- 计算属性 ----------
const hpPercent = computed(() =>
  player.value ? Math.max(0, Math.min(100, (player.value.hp / player.value.maxHp) * 100)) : 0
);

const expPercent = computed(() => {
  if (!player.value || player.value.level <= 0) return 0;
  const need = player.value.level * 100;
  return Math.min(100, (player.value.exp / need) * 100);
});

const suggestions = computed(() => {
  if (!history.value.length) return [];
  const last = history.value[history.value.length - 1];
  return (last && last.choices) || [];
});

// ---------- 工具 ----------

// 品质颜色（与后端 server/quality.js 保持一致）
const QUALITY_COLORS = {
  '普通': '#9aa7b4',
  '优秀': '#4dabf7',
  '稀有': '#b197fc',
  '史诗': '#fcc419',
  '传说': '#ff6b6b',
};

/**
 * 解析装备/物品名，拆出类型、纯名称、品质。
 * 格式：武器·短刃[稀有] / 防具·皮甲[普通] / 干粮 x2
 */
function parseItemName(raw) {
  const s = String(raw || '').trim();
  let type = 'item';
  let rest = s;
  if (rest.startsWith('武器·')) { type = 'weapon'; rest = rest.slice(3); }
  else if (rest.startsWith('防具·')) { type = 'armor'; rest = rest.slice(3); }
  const m = rest.match(/^(.*?)\[([^\]]+)\]$/);
  const name = m ? m[1].trim() : rest.trim();
  const quality = m ? m[2] : null;
  return { type, name, quality, color: quality ? (QUALITY_COLORS[quality] || '#9aa7b4') : null };
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

async function refreshSaves() {
  saves.value = await api('/saves');
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

// ---------- 开始 / 读档 ----------
async function startGame() {
  const name = document.getElementById('nameInput')?.value.trim() || '';
  if (!name) {
    error.value = '请输入你的冒险者名字';
    return;
  }
  error.value = '';
  loading.value = true;
  try {
    const data = await api('/games', { method: 'POST', body: JSON.stringify({ playerName: name }) });
    enterGame(data);
    await pushAction('环顾四周，了解一下你身处何方，准备开始冒险！');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadSave(id) {
  error.value = '';
  loading.value = true;
  try {
    const data = await api(`/games/${id}`);
    enterGame(data);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function enterGame(data) {
  gameId.value = data.id;
  player.value = data.player;
  history.value = data.history || [];
  gameOver.value = player.value.hp <= 0;
  inBattle.value = false;
  lastEffects.value = [];
  view.value = 'game';
  scrollToBottom();
}

async function backToHome() {
  view.value = 'home';
  await refreshSaves();
}

// ---------- 核心：执行动作 ----------
async function pushAction(actionText) {
  if (loading.value || gameOver.value || !actionText.trim()) return;
  error.value = '';
  loading.value = true;
  inBattle.value = false;
  input.value = '';

  // 先把玩家输入回显到对话流
  history.value.push({ role: 'user', content: actionText });

  try {
    const result = await api(`/games/${gameId.value}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: actionText }),
    });

    player.value = result.player;
    inBattle.value = result.battle;
    lastEffects.value = result.effects || [];
    // 降级接续：AI 本次未按格式返回 JSON，后端已直接接续剧情，用游戏内语言给玩家一个简短过渡
    const narrative = result.degraded
      ? result.narrative + '\n\n—— 你的举动在艾泽洛姆掀起涟漪，命运之线悄然转动。'
      : result.narrative;
    history.value.push({ role: 'assistant', content: narrative, choices: result.choices || [] });
    gameOver.value = result.gameOver || player.value.hp <= 0;
  } catch (e) {
    // 后端出错时回滚刚才回显的玩家输入
    if (history.value.length && history.value[history.value.length - 1].role === 'user') {
      history.value.pop();
    }
    error.value = e.message;
  } finally {
    loading.value = false;
    scrollToBottom();
  }
}

function useSuggestion(text) {
  pushAction(text);
}

function restart() {
  view.value = 'home';
  player.value = null;
  history.value = [];
  gameId.value = '';
  gameOver.value = false;
  refreshSaves();
}

// ---------- 生命周期 ----------
onMounted(refreshSaves);
watch(history, scrollToBottom, { deep: true });
</script>

<template>
  <!-- ============ 首页：新建 / 读档 ============ -->
  <div v-if="view === 'home'" class="home">
    <div class="home-card">
      <h1 class="title">⚔️ 艾泽洛姆</h1>
      <p class="subtitle">AI 驱动的文字冒险世界 · 你的每一个选择都将改变命运</p>

      <div class="start-box">
        <input
          id="nameInput"
          type="text"
          maxlength="20"
          placeholder="输入你的冒险者名字"
          @keyup.enter="startGame"
        />
        <button class="btn primary" :disabled="loading" @click="startGame">
          {{ loading ? '进入世界…' : '开始新冒险' }}
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="saves.length" class="save-list">
        <h2>继续冒险</h2>
        <div
          v-for="s in saves"
          :key="s.id"
          class="save-item"
          @click="loadSave(s.id)"
        >
          <span class="save-name">{{ s.playerName }}</span>
          <span class="save-meta">Lv.{{ s.level }} · {{ new Date(s.updatedAt).toLocaleString() }}</span>
        </div>
      </div>

      <p v-else class="hint">尚无存档，从第一场冒险开始吧</p>
    </div>
  </div>

  <!-- ============ 游戏主界面 ============ -->
  <div v-else class="game">
    <!-- 左侧：角色状态 -->
    <aside class="side-panel">
      <div class="panel-head">
        <h2>{{ player.name }}</h2>
        <button class="btn ghost" @click="backToHome">← 主菜单</button>
      </div>

      <div class="stat">
        <div class="stat-label">等级 <b>{{ player.level }}</b></div>
        <div class="bar"><div class="bar-fill exp" :style="{ width: expPercent + '%' }"></div></div>
      </div>

      <div class="stat">
        <div class="stat-label">生命 <b>{{ player.hp }} / {{ player.maxHp }}</b></div>
        <div class="bar"><div class="bar-fill hp" :style="{ width: hpPercent + '%' }"></div></div>
      </div>

      <div class="stat gold">金币 <b>{{ player.gold }}</b></div>

      <!-- 武器 / 防具 槽（带品质颜色） -->
      <div class="slot">
        <span class="slot-label">武器</span>
        <span
          class="slot-value"
          :style="player.weapon && parseItemName(player.weapon).color ? { color: parseItemName(player.weapon).color } : {}"
        >
          {{ player.weapon ? parseItemName(player.weapon).name : '徒手' }}
          <em v-if="player.weapon && parseItemName(player.weapon).quality">[{{ parseItemName(player.weapon).quality }}]</em>
        </span>
      </div>
      <div class="slot">
        <span class="slot-label">防具</span>
        <span
          class="slot-value"
          :style="player.armor && parseItemName(player.armor).color ? { color: parseItemName(player.armor).color } : {}"
        >
          {{ player.armor ? parseItemName(player.armor).name : '无' }}
          <em v-if="player.armor && parseItemName(player.armor).quality">[{{ parseItemName(player.armor).quality }}]</em>
        </span>
      </div>

      <div class="inventory">
        <h3>背包</h3>
        <ul>
          <li v-for="item in player.inventory" :key="item">{{ item }}</li>
          <li v-if="!player.inventory.length" class="dim">空空如也</li>
        </ul>
      </div>

      <div v-if="inBattle" class="battle-flag">⚔️ 战斗中</div>
      <div v-if="gameOver" class="battle-flag dead">💀 已阵亡</div>
    </aside>

    <!-- 右侧：剧情流 + 输入 -->
    <main class="main-panel">
      <div ref="messagesEl" class="messages">
        <div
          v-for="(m, i) in history"
          :key="i"
          class="msg"
          :class="m.role === 'user' ? 'user' : 'assistant'"
        >
          <div v-if="m.role === 'user'" class="bubble user-bubble">{{ m.content }}</div>
          <template v-else>
            <div class="narrative">{{ m.content }}</div>
            <div v-if="m.choices && m.choices.length" class="choices">
              <button
                v-for="c in m.choices"
                :key="c"
                class="choice"
                :disabled="loading"
                @click="useSuggestion(c)"
              >
                {{ c }}
              </button>
            </div>
          </template>
        </div>

        <div v-if="lastEffects.length" class="effects">
          <span v-for="(e, i) in lastEffects" :key="i">{{ e }}</span>
        </div>

        <div v-if="loading" class="typing">…… 世界正在回应你的行动 ……</div>
        <div v-if="gameOver" class="game-over">旅程在此终结。愿你的传说被后人传颂。</div>
      </div>

      <div class="input-bar">
        <p v-if="error" class="error inline">{{ error }}</p>
        <form class="input-row" @submit.prevent="pushAction(input)">
          <input
            v-model="input"
            type="text"
            maxlength="200"
            placeholder="输入你的行动…（例：拔出剑警惕地环顾四周）"
            :disabled="loading || gameOver"
            autocomplete="off"
          />
          <button class="btn primary" type="submit" :disabled="loading || gameOver">
            {{ loading ? '…' : '行动' }}
          </button>
        </form>
        <div v-if="gameOver" class="restart-row">
          <button class="btn primary" @click="restart">重新开始</button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(212, 161, 44, 0.12), transparent 50%),
    radial-gradient(ellipse at 70% 80%, rgba(60, 90, 160, 0.15), transparent 50%),
    var(--bg);
}

.home-card {
  width: min(460px, 90vw);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 40px 36px;
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
  margin: 10px 0 28px;
  font-size: 14px;
}

.start-box {
  display: flex;
  gap: 10px;
}

.start-box input,
.input-row input {
  flex: 1;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  outline: none;
  font-size: 15px;
}

.start-box input:focus,
.input-row input:focus {
  border-color: var(--accent);
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
  padding: 6px 12px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  font-size: 13px;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.error {
  color: var(--danger);
  margin-top: 12px;
  font-size: 14px;
}

.error.inline {
  margin: 0 0 8px;
}

.hint {
  color: var(--text-dim);
  text-align: center;
  margin-top: 24px;
  font-size: 14px;
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

/* ===== 游戏界面 ===== */
.game {
  height: 100%;
  display: grid;
  grid-template-columns: 260px 1fr;
  max-width: 1200px;
  margin: 0 auto;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}

.side-panel {
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 20px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-head h2 {
  font-size: 18px;
  color: var(--accent-2);
}

.stat {
  font-size: 14px;
  color: var(--text-dim);
}

.stat b {
  color: var(--text);
  float: right;
}

.stat.gold b {
  color: var(--accent-2);
}

.bar {
  height: 8px;
  background: var(--hp-bg);
  border-radius: 4px;
  margin-top: 6px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.bar-fill.hp {
  background: linear-gradient(90deg, #2ea043, var(--hp));
}

.bar-fill.exp {
  background: linear-gradient(90deg, #8250df, #a371f7);
}

.inventory {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.slot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  padding: 6px 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.slot-label {
  color: var(--text-dim);
}

.slot-value {
  font-weight: 600;
}

.slot-value em {
  font-style: normal;
  font-size: 12px;
  opacity: 0.9;
}

.inventory h3 {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}

.inventory ul {
  list-style: none;
}

.inventory li {
  padding: 5px 0;
  font-size: 14px;
}

.inventory .dim {
  color: var(--text-dim);
}

.battle-flag {
  margin-top: auto;
  text-align: center;
  padding: 10px;
  border-radius: 8px;
  background: rgba(217, 82, 78, 0.15);
  color: var(--danger);
  font-weight: 700;
  border: 1px solid rgba(217, 82, 78, 0.4);
}

.battle-flag.dead {
  color: #c8d1dc;
  background: rgba(200, 209, 220, 0.08);
  border-color: rgba(200, 209, 220, 0.25);
}

.main-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.msg.user {
  align-self: flex-end;
  max-width: 75%;
}

.user-bubble {
  background: var(--panel-2);
  border: 1px solid var(--border);
  padding: 10px 16px;
  border-radius: 12px 12px 4px 12px;
}

.narrative {
  max-width: 100%;
  white-space: pre-wrap;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.choice {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 20px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  transition: all 0.15s;
}

.choice:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-2);
}

.effects {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.effects span {
  font-size: 13px;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(212, 161, 44, 0.12);
  color: var(--accent-2);
  border: 1px solid rgba(212, 161, 44, 0.3);
}

.typing {
  color: var(--text-dim);
  font-style: italic;
  animation: blink 1.2s infinite;
}

@keyframes blink {
  50% {
    opacity: 0.4;
  }
}

.game-over {
  text-align: center;
  color: var(--text-dim);
  padding: 20px;
  font-size: 16px;
  border: 1px dashed var(--border);
  border-radius: 12px;
}

.input-bar {
  border-top: 1px solid var(--border);
  padding: 16px 28px;
  background: var(--panel);
}

.input-row {
  display: flex;
  gap: 10px;
}

.restart-row {
  margin-top: 12px;
  text-align: center;
}

@media (max-width: 720px) {
  .game {
    grid-template-columns: 1fr;
  }
  .side-panel {
    flex-direction: row;
    flex-wrap: wrap;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .inventory {
    display: none;
  }
  .battle-flag {
    margin-top: 0;
  }
}
</style>
