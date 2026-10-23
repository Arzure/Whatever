<script setup>
import { ref, computed, onMounted, nextTick, watch, inject } from 'vue';

const { state, hpPercent, expPercent } = inject('game');
const { submitAction, restart, useItem, discardItem, equipItem, unequipItem, cancelPending } =
  inject('game');

const input = ref('');
const messagesEl = ref(null);
// 手机端背包折叠状态（默认收起，点按展开；桌面端始终展开）
const invOpen = ref(false);

// 由世界观 capabilities 驱动界面（是否战斗、启用哪些数值、有哪些装备槽）
const caps = computed(() => state.theme?.capabilities || { statSchema: ['hp'], slots: [], itemCategories: ['item'], hasCombat: true });
const stats = computed(() => caps.value.statSchema || []);
const slots = computed(() => caps.value.slots || []);
const hasItem = computed(() => (caps.value.itemCategories || []).includes('item'));

// 品质颜色（与后端 server/quality.js 保持一致）
const QUALITY_COLORS = {
  普通: '#9aa7b4',
  优秀: '#4dabf7',
  稀有: '#b197fc',
  史诗: '#fcc419',
  传说: '#ff6b6b',
};

/** 解析物品名：拆出类型、纯名称、品质（武器·短刃[稀有] / 干粮 x2） */
function parseItemName(raw) {
  const s = String(raw || '').trim();
  let type = 'item';
  let rest = s;
  if (rest.startsWith('武器·')) {
    type = 'weapon';
    rest = rest.slice(3);
  } else if (rest.startsWith('防具·')) {
    type = 'armor';
    rest = rest.slice(3);
  }
  const m = rest.match(/^(.*?)\[([^\]]+)\]$/);
  const name = m ? m[1].trim() : rest.trim();
  const quality = m ? m[2] : null;
  return { type, name, quality, color: quality ? QUALITY_COLORS[quality] || '#9aa7b4' : null };
}

function isEquip(item) {
  const t = parseItemName(item).type;
  return t === 'weapon' || t === 'armor';
}

const disabled = computed(() => state.loading || state.gameOver);

function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  submitAction(text);
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
    <!-- 左侧：角色状态（按世界观动态渲染） -->
    <aside class="side-panel">
      <div class="panel-head">
        <h2>{{ state.player.name }}</h2>
      </div>

      <div v-if="stats.includes('exp')" class="stat">
        <div class="stat-label">等级 <b>{{ state.player.level }}</b></div>
        <div class="bar"><div class="bar-fill exp" :style="{ width: expPercent + '%' }"></div></div>
      </div>

      <div v-if="stats.includes('hp')" class="stat">
        <div class="stat-label">生命 <b>{{ state.player.hp }} / {{ state.player.maxHp }}</b></div>
        <div class="bar"><div class="bar-fill hp" :style="{ width: hpPercent + '%' }"></div></div>
      </div>

      <div v-if="stats.includes('gold')" class="stat gold">
        {{ state.player.gold }} 枚金币
      </div>

      <!-- 装备槽（由世界观 capabilities.slots 决定） -->
      <div v-for="s in slots" :key="s.id" class="slot">
        <span class="slot-label">{{ s.label }}</span>
        <span
          class="slot-value"
          :style="state.player.slots?.[s.id] && parseItemName(state.player.slots[s.id]).color ? { color: parseItemName(state.player.slots[s.id]).color } : {}"
        >
          {{ state.player.slots?.[s.id] ? parseItemName(state.player.slots[s.id]).name : '无' }}
          <em v-if="state.player.slots?.[s.id] && parseItemName(state.player.slots[s.id]).quality">
            [{{ parseItemName(state.player.slots[s.id]).quality }}]
          </em>
        </span>
        <button
          v-if="state.player.slots?.[s.id]"
          class="slot-btn"
          :disabled="disabled"
          title="卸下"
          @click="unequipItem(s.id)"
        >卸下</button>
      </div>

      <!-- 背包 -->
      <div v-if="hasItem" class="inventory" :class="{ open: invOpen }">
        <h3 @click="invOpen = !invOpen">背包 <span class="inv-toggle">{{ invOpen ? '收起' : '展开' }}</span></h3>
        <ul>
          <li v-for="item in state.player.inventory" :key="item" class="inv-item">
            <span>{{ item }}</span>
            <span class="inv-actions">
              <button v-if="isEquip(item)" class="slot-btn mini" :disabled="disabled" @click="equipItem(item)">
                装备
              </button>
              <button v-else class="slot-btn mini" :disabled="disabled" @click="useItem(item)">使用</button>
              <button class="slot-btn mini danger" :disabled="disabled" title="丢弃 1 个（可撤销）" @click="discardItem(item)">
                丢弃
              </button>
            </span>
          </li>
          <li v-if="!state.player.inventory.length" class="dim">空空如也</li>
        </ul>
      </div>

      <div v-if="caps.hasCombat && state.inBattle" class="battle-flag">⚔️ 战斗中</div>
      <div v-if="state.gameOver" class="battle-flag dead">💀 已阵亡</div>
    </aside>

    <!-- 右侧：剧情流 + 输入 -->
    <main class="main-panel">
      <div ref="messagesEl" class="messages">
        <div
          v-for="(m, i) in state.history"
          :key="i"
          class="msg"
          :class="m.role === 'user' ? 'user' : 'assistant'"
        >
          <div v-if="m.role === 'user'" class="bubble user-bubble">{{ m.content }}</div>
          <template v-else>
            <div class="narrative">{{ m.content }}</div>
            <div v-if="m.choices && m.choices.length" class="choices">
              <button v-for="c in m.choices" :key="c" class="choice" :disabled="state.loading" @click="submitAction(c)">
                {{ c }}
              </button>
            </div>
          </template>
        </div>

        <div v-if="state.lastEffects.length" class="effects">
          <span v-for="(e, i) in state.lastEffects" :key="i">{{ e }}</span>
        </div>

        <div v-if="state.loading" class="typing">…… 世界正在回应你的行动 ……</div>
        <div v-if="state.gameOver" class="game-over">旅程在此终结。愿你的传说被后人传颂。</div>
      </div>

      <div class="input-bar">
        <p v-if="state.error" class="error inline">{{ state.error }}</p>

        <!-- 待结算动作框：提交前可撤销 -->
        <div v-if="state.pendingActions.length" class="pending-bar">
          <span class="pending-label">待结算动作：</span>
          <span v-for="(p, i) in state.pendingActions" :key="i" class="pending-chip">
            {{ p.message }}
            <button class="pending-x" :disabled="state.loading" title="撤销此动作" @click="cancelPending(i)">✕</button>
          </span>
        </div>

        <form class="input-row" @submit.prevent="send">
          <input
            v-model="input"
            type="text"
            maxlength="200"
            placeholder="输入你的行动…（例：拔出剑警惕地环顾四周）"
            :disabled="disabled"
            autocomplete="off"
          />
          <button class="btn primary" type="submit" :disabled="disabled">
            {{ state.loading ? '…' : '行动' }}
          </button>
        </form>

        <div v-if="state.gameOver" class="restart-row">
          <button class="btn primary" @click="restart">重新开始</button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
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
  padding: calc(var(--bar-h, 48px) + 20px) 18px 20px;
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

.slot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
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
  flex: 1;
  text-align: right;
}

.slot-value em {
  font-style: normal;
  font-size: 12px;
  opacity: 0.9;
}

.slot-btn {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  background: var(--panel);
  transition: all 0.15s;
}

.slot-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-2);
}

.slot-btn.mini {
  padding: 2px 8px;
  font-size: 11px;
}

.slot-btn.danger {
  border-color: #e5484d55;
  color: #e5484d;
}

.slot-btn.danger:hover:not(:disabled) {
  border-color: #e5484d;
  color: #ff6b6b;
}

.inventory {
  border-top: 1px solid var(--border);
  padding-top: 12px;
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

.inv-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.inv-actions {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
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
  padding: calc(var(--bar-h, 48px) + 24px) 28px 24px;
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
  padding: 16px 28px calc(16px + env(safe-area-inset-bottom));
  background: var(--panel);
}

.error.inline {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 14px;
}

.pending-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  background: rgba(212, 161, 44, 0.08);
  border: 1px dashed rgba(212, 161, 44, 0.4);
  border-radius: 8px;
  font-size: 13px;
}

.pending-label {
  color: var(--accent-2);
  font-weight: 600;
}

.pending-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--text);
}

.pending-x {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 50%;
}

.pending-x:hover:not(:disabled) {
  color: var(--danger);
}

.input-row {
  display: flex;
  gap: 10px;
}

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

.input-row input:focus {
  border-color: var(--accent);
}

.restart-row {
  margin-top: 12px;
  text-align: center;
}
/* 背包折叠开关：仅手机端显示 */
.inv-toggle {
  display: none;
}

@media (max-width: 768px) {
  .game {
    grid-template-columns: 1fr;
  }
  .side-panel {
    flex-direction: row;
    flex-wrap: wrap;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  /* 背包：折叠面板（点按展开），功能完整保留，不再隐藏 */
  .inventory {
    flex: 1 1 100%;
    border-top: 1px solid var(--border);
  }
  .inventory h3 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    user-select: none;
  }
  .inv-toggle {
    display: inline;
    font-size: 12px;
    color: var(--accent);
  }
  .inventory ul {
    display: none;
  }
  .inventory.open ul {
    display: block;
  }
  .battle-flag {
    margin-top: 0;
  }
}
/* —— 阶段三动效：消息入场 + 按钮微交互 + 阶段标题文字动画（对标 reactbits/animata） —— */
.msg { animation: msg-in 0.32s ease both; }
@keyframes msg-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.phase-badge { animation: badge-in 0.55s ease both; }
@keyframes badge-in { from { opacity: 0; letter-spacing: 0.45em; } to { opacity: 1; letter-spacing: normal; } }
/* —— 阶段三第4项：消息卡片悬停反馈——边框亮起+轻微提亮，操作反馈而非装饰 —— */
.msg .msg-content { transition: border-color 0.18s ease, filter 0.18s ease, box-shadow 0.18s ease; }
.msg:hover .msg-content { border-color: var(--accent); filter: brightness(1.06); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18); }
</style>
