<script setup>
import { ref, computed, onMounted, nextTick, watch, inject } from 'vue';

const { state, listenSpeeches, adjudicateTarget, backToHome, restart } = inject('game');

const messagesEl = ref(null);

const d = computed(() => state.deduction || {});
const phase = computed(() => d.value.phase || 'day');
const disabled = computed(() => state.loading || state.gameOver);
const canAdjudicate = computed(() => !!d.value.canAdjudicate && !disabled.value);
const canListen = computed(() => phase.value === 'day' && !state.gameOver && !state.loading);

const PHASE_TEXT = {
  day: '白天·听取发言',
  adjudicate: '裁决阶段',
  win: '好人获胜',
  lose: '狼人获胜',
};

function doExecute(targetId) {
  const p = (d.value.players || []).find((x) => x.id === targetId);
  const sure = window.confirm(`确定处刑「${p?.name || ''}」吗？处刑会公开其真实身份牌，若误伤好人将损失一名好人。`);
  if (!sure) return;
  adjudicateTarget(targetId);
}

function doPass() {
  const sure = window.confirm('确定放弃处刑吗？今天无人被放逐，直接进入下一夜。');
  if (!sure) return;
  adjudicateTarget('');
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
    <!-- 左侧：法官状态 + 存活玩家 + 死讯 -->
    <aside class="side-panel">
      <div class="panel-head">
        <h2>⚖️ {{ state.player?.name }}</h2>
        <button class="btn ghost" @click="backToHome">← 主菜单</button>
      </div>

      <div class="phase-badge" :class="phase">{{ PHASE_TEXT[phase] || phase }}</div>

      <div class="judge-hint">
        <span class="muted">你是法官——不参与游戏，只听发言、裁决处刑。</span>
      </div>

      <div class="stat-row">
        <span>第 {{ d.round || 1 }} 天</span>
        <span>存活 {{ d.aliveCount || 0 }}/{{ (d.players || []).length }}</span>
      </div>

      <!-- 玩家列表 -->
      <div class="players">
        <h3>在场者</h3>
        <div
          v-for="p in d.players || []"
          :key="p.id"
          class="player-row"
          :class="{ dead: !p.alive }"
        >
          <span class="player-name">{{ p.name }}</span>
          <span class="player-status">{{ p.alive ? '存活' : '出局' }}</span>
        </div>
      </div>

      <!-- 死讯 -->
      <div v-if="(d.deaths || []).length" class="deaths">
        <h3>死讯记录</h3>
        <div v-for="(dd, i) in d.deaths" :key="i" class="death-row">
          <span class="death-round">第{{ dd.round }}天</span>
          <span class="death-name">{{ dd.name }}</span>
          <span class="death-cause">{{ dd.cause === 'execute' ? '被处刑' : '夜里遇害' }}</span>
          <b v-if="dd.role" :class="dd.role === '狼人' ? 'role-wolf' : 'role-good'">{{ dd.role }}</b>
        </div>
      </div>

      <!-- 身份复盘（游戏结束） -->
      <div v-if="d.roles" class="reveal">
        <h3>身份复盘</h3>
        <div v-for="(r, i) in d.roles" :key="i" class="reveal-row">
          <span>{{ r.name }}</span>
          <b :class="r.role === '狼人' ? 'role-wolf' : 'role-good'">{{ r.role }}</b>
        </div>
      </div>

      <button v-if="state.gameOver" class="btn primary full" @click="restart">再开一局</button>
    </aside>

    <!-- 主区：发言流 + 裁决面板 -->
    <main class="main-panel">
      <div class="messages" ref="messagesEl">
        <div
          v-for="(msg, i) in state.history"
          :key="i"
          class="msg assistant"
        >
          <div class="msg-content">{{ msg.content }}</div>
        </div>
        <div v-if="state.loading" class="msg assistant">
          <div class="msg-content loading-text">大家正在发言…</div>
        </div>
      </div>

      <div v-if="state.error" class="error-bar">{{ state.error }}</div>

      <!-- 白天：听取发言（法官无需输入文字） -->
      <div v-else-if="canListen" class="listen-bar">
        <button class="btn listen-btn" :disabled="disabled" @click="listenSpeeches">
          {{ state.loading ? '正在听取发言…' : '🗣️ 听取所有存活者发言' }}
        </button>
        <p class="listen-hint">法官无需发言，点击按钮即可听取在场所有人的陈述。</p>
      </div>

      <!-- 裁决面板 -->
      <div v-else-if="canAdjudicate" class="adjudicate-panel">
        <p class="adjudicate-hint">现在由你裁决。处刑某位存活者会公开其真实身份牌；或放弃处刑直接进入下一夜。</p>
        <div class="vote-list">
          <button
            v-for="p in (d.players || []).filter((x) => x.alive)"
            :key="p.id"
            class="execute-btn"
            :disabled="disabled"
            @click="doExecute(p.id)"
          >
            ⚔️ 处刑 {{ p.name }}
          </button>
        </div>
        <button class="pass-btn" :disabled="disabled" @click="doPass">🛡️ 放弃处刑（进入下一夜）</button>
      </div>

      <div v-else-if="state.gameOver" class="end-bar">
        <p class="end-text">{{ d.winner === 'good' ? '🌅 狼人全部落网，好人获胜！' : '🐺 狼人潜伏到最后，好人失败…' }}</p>
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
.phase-badge.adjudicate { background: rgba(180, 60, 60, 0.2); color: #e88; }
.phase-badge.win { background: rgba(60, 160, 80, 0.2); color: #8d8; }
.phase-badge.lose { background: rgba(120, 120, 120, 0.2); color: var(--text-dim); }

.judge-hint {
  font-size: 13px;
}
.muted { color: var(--text-dim); font-size: 13px; }

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-dim);
}

.players h3,
.deaths h3,
.reveal h3 {
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
.player-status { font-size: 12px; color: var(--text-dim); }

.deaths {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.death-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 3px 0;
  font-size: 13px;
}
.death-round { color: var(--text-dim); font-size: 11px; }
.death-name { color: var(--text); }
.death-cause { color: var(--text-dim); font-size: 12px; }
.role-wolf { color: var(--danger); font-weight: 600; font-size: 12px; }
.role-good { color: #8d8; font-weight: 600; font-size: 12px; }

.reveal {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.reveal-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 14px;
}

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
  max-width: 100%;
  align-self: stretch;
}
.msg-content {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
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

.listen-bar {
  padding: 14px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.listen-btn {
  width: 100%;
  padding: 14px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
  border: 1px solid var(--accent);
  background: rgba(212, 161, 44, 0.12);
  color: var(--accent-2);
  cursor: pointer;
  transition: all 0.15s;
}
.listen-btn:hover:not(:disabled) {
  background: rgba(212, 161, 44, 0.22);
}
.listen-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.listen-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
}

.adjudicate-panel {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.adjudicate-hint {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.vote-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.execute-btn {
  padding: 8px 14px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: rgba(200, 60, 60, 0.08);
  color: #e88;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.execute-btn:hover:not(:disabled) {
  background: rgba(200, 60, 60, 0.2);
}
.execute-btn:disabled,
.pass-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pass-btn {
  width: 100%;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.pass-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-2);
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
