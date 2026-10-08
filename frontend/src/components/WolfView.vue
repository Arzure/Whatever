<script setup>
import { ref, computed, onMounted, nextTick, watch, inject } from 'vue';

const { state, submitAction, voteTarget, backToHome, restart } = inject('game');

const input = ref('');
const messagesEl = ref(null);

const w = computed(() => state.wolf || {});
const phase = computed(() => w.value.phase || 'day');
const disabled = computed(() => state.loading || state.gameOver);
const canSpeak = computed(() => !!w.value.canSpeak && !disabled.value);
const canVote = computed(() => !!w.value.canVote && !disabled.value);
const alivePlayers = computed(() => (w.value.players || []).filter((p) => p.alive));
const player = computed(() => (w.value.players || []).find((p) => p.isPlayer));

const PHASE_TEXT = {
  day: '白天·发言',
  vote: '投票阶段',
  win: '好人获胜',
  lose: '狼人获胜',
};

function playerName(id) {
  return (w.value.players || []).find((p) => p.id === id)?.name || id;
}

function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  submitAction(text);
}

function doVote(targetId) {
  const name = playerName(targetId);
  const sure = window.confirm(`确定投票放逐「${name}」吗？`);
  if (!sure) return;
  voteTarget(targetId);
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

onMounted(scrollToBottom);
watch(() => state.history.length, scrollToBottom);
</script>

<template>
  <div class="game">
    <!-- 左侧：角色状态 + 存活玩家 -->
    <aside class="side-panel">
      <div class="panel-head">
        <h2>{{ state.player?.name }}</h2>
        <button class="btn ghost" @click="backToHome">← 主菜单</button>
      </div>

      <div class="phase-badge" :class="phase">{{ PHASE_TEXT[phase] || phase }}</div>

      <div class="wolf-role">
        <span class="muted">你的身份</span>
        <b class="role-tag good">{{ w.playerRole || '村民' }}</b>
      </div>

      <div class="stat-row">
        <span>第 {{ w.round || 1 }} 天</span>
        <span>存活 {{ w.aliveCount || 0 }}/{{ (w.players || []).length }}</span>
      </div>

      <!-- 玩家列表 -->
      <div class="wolf-players">
        <h3>玩家</h3>
        <div
          v-for="p in w.players || []"
          :key="p.id"
          class="player-row"
          :class="{ dead: !p.alive, me: p.isPlayer }"
        >
          <span class="player-name">{{ p.name }}{{ p.isPlayer ? '（你）' : '' }}</span>
          <span class="player-status">{{ p.alive ? '存活' : '出局' }}</span>
        </div>
      </div>

      <!-- 死讯 -->
      <div v-if="(w.deaths || []).length" class="wolf-deaths">
        <h3>死讯</h3>
        <div v-for="(d, i) in w.deaths" :key="i" class="death-row">
          <span class="death-name">{{ d.name }}</span>
          <span class="death-cause">{{ d.cause === 'vote' ? '被放逐' : '夜里遇害' }}</span>
          <span v-if="d.role" class="death-role">{{ d.role }}</span>
        </div>
      </div>

      <!-- 身份复盘（游戏结束） -->
      <div v-if="w.roles" class="wolf-reveal">
        <h3>身份复盘</h3>
        <div v-for="(r, i) in w.roles" :key="i" class="reveal-row">
          <span>{{ r.name }}{{ r.isPlayer ? '（你）' : '' }}</span>
          <b :class="r.role === '狼人' ? 'role-wolf' : 'role-good'">{{ r.role }}</b>
        </div>
      </div>

      <button v-if="state.gameOver" class="btn primary full" @click="restart">再来一局</button>
    </aside>

    <!-- 主区：对话流 + 输入 / 投票面板 -->
    <main class="main-panel">
      <div class="messages" ref="messagesEl">
        <div
          v-for="(msg, i) in state.history"
          :key="i"
          class="msg"
          :class="msg.role"
        >
          <div class="msg-content">{{ msg.content }}</div>
        </div>
        <div v-if="state.loading" class="msg assistant">
          <div class="msg-content loading-text">{{ state.mode === 'wolf' && phase === 'day' ? '大家正在发言…' : '处理中…' }}</div>
        </div>
      </div>

      <div v-if="state.error" class="error-bar">{{ state.error }}</div>

      <!-- 发言输入（白天） -->
      <div v-if="canSpeak" class="input-bar">
        <textarea
          v-model="input"
          rows="2"
          maxlength="500"
          placeholder="输入你的白天发言…"
          @keydown.ctrl.enter="send"
        ></textarea>
        <button class="btn primary" :disabled="disabled || !input.trim()" @click="send">发言</button>
      </div>

      <!-- 投票面板 -->
      <div v-else-if="canVote" class="vote-panel">
        <p class="vote-hint">选择你要投票放逐的人：</p>
        <div class="vote-list">
          <button
            v-for="p in alivePlayers.filter((x) => !x.isPlayer)"
            :key="p.id"
            class="vote-btn"
            :disabled="disabled"
            @click="doVote(p.id)"
          >
            {{ p.name }}
          </button>
        </div>
      </div>

      <div v-else-if="state.gameOver" class="end-bar">
        <p class="end-text">{{ w.winner === 'good' ? '🌙 好人阵营获胜！' : '🐺 狼人获胜…' }}</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.game {
  display: flex;
  height: 100%;
}

.side-panel {
  width: 280px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.phase-badge {
  text-align: center;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  background: rgba(212, 161, 44, 0.15);
  color: var(--accent-2);
}
.phase-badge.vote { background: rgba(180, 60, 60, 0.2); color: #e88; }
.phase-badge.win { background: rgba(60, 160, 80, 0.2); color: #8d8; }
.phase-badge.lose { background: rgba(120, 120, 120, 0.2); color: var(--text-dim); }

.wolf-role {
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted { color: var(--text-dim); font-size: 13px; }
.role-tag.good {
  color: #8d8;
  font-size: 15px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-dim);
}

.wolf-players h3,
.wolf-deaths h3,
.wolf-reveal h3 {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
}

.player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 14px;
}
.player-row.dead { opacity: 0.45; text-decoration: line-through; }
.player-row.me .player-name { color: var(--accent-2); font-weight: 600; }
.player-status { font-size: 12px; color: var(--text-dim); }

.wolf-deaths {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.death-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 3px 0;
  font-size: 13px;
}
.death-name { color: var(--text); }
.death-cause { color: var(--text-dim); font-size: 12px; }
.death-role { color: var(--danger); font-weight: 600; font-size: 12px; }

.wolf-reveal {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.reveal-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 14px;
}
.role-wolf { color: var(--danger); }
.role-good { color: #8d8; }

.main-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.msg {
  max-width: 80%;
}
.msg.user {
  align-self: flex-end;
}
.msg.assistant {
  align-self: flex-start;
}
.msg-content {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.user .msg-content {
  background: rgba(212, 161, 44, 0.12);
  border: 1px solid rgba(212, 161, 44, 0.3);
}
.msg.assistant .msg-content {
  background: var(--panel-2);
  border: 1px solid var(--border);
}
.loading-text {
  color: var(--text-dim);
  font-style: italic;
}

.error-bar {
  padding: 8px 16px;
  color: var(--danger);
  font-size: 13px;
  background: rgba(200, 60, 60, 0.08);
}

.input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.input-bar textarea {
  flex: 1;
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  resize: none;
  outline: none;
}
.input-bar textarea:focus {
  border-color: var(--accent);
}

.vote-panel {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.vote-hint {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.vote-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.vote-btn {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.vote-btn:hover:not(:disabled) {
  border-color: var(--danger);
  background: rgba(200, 60, 60, 0.1);
}
.vote-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.end-bar {
  padding: 16px;
  text-align: center;
  border-top: 1px solid var(--border);
}
.end-text {
  font-size: 18px;
  font-weight: 600;
}

.btn {
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  transition: opacity 0.15s;
}
.btn.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #1a1303;
}
.btn.ghost {
  border: 1px solid var(--border);
  color: var(--text-dim);
  background: transparent;
}
.btn.full {
  width: 100%;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
