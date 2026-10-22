<script setup>
import { ref, nextTick, inject, onMounted } from 'vue';
import Icon from './Icon.vue';

const { state, backToHome } = inject('game');

// —— 共享元素飞入（FLIP）：挂载时从首页入口卡片的屏幕位置/尺寸平滑扩张成整个对话页 ——
const chatEl = ref(null);
onMounted(() => {
  const el = chatEl.value;
  const from = state.chatRect;
  if (!el || !from) return;
  const cur = el.getBoundingClientRect();
  const sx = from.width / cur.width;
  const sy = from.height / cur.height;
  const dx = (from.left + from.width / 2) - (cur.left + cur.width / 2);
  const dy = (from.top + from.height / 2) - (cur.top + cur.height / 2);
  el.style.transformOrigin = 'center';
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  el.style.opacity = '0.55';
  el.style.borderRadius = '14px';
  requestAnimationFrame(() => {
    el.style.transition = 'transform 0.55s cubic-bezier(0.22, 1.2, 0.36, 1), opacity 0.45s ease, border-radius 0.55s ease';
    el.style.transform = 'none';
    el.style.opacity = '1';
    el.style.borderRadius = '0';
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      state.chatRect = null;
    }, 620);
  });
});

// —— 对话状态（骨架：消息流 + 输入栏，后端 LLM 接线后续任务） ——
const messages = ref([
  { role: 'assistant', content: '您好，我是万象工坊的 AI 助手。有什么可以帮您？' }
]);
const input = ref('');
const sending = ref(false);
const messagesEl = ref(null);

function send() {
  const text = input.value.trim();
  if (!text || sending.value) return;
  messages.value.push({ role: 'user', content: text });
  input.value = '';
  sending.value = true;
  scrollToBottom();
  // 骨架阶段：模拟回复占位，后端 LLM 接线后替换为真实流式响应
  setTimeout(() => {
    messages.value.push({ role: 'assistant', content: '（对话能力接入中——后端 LLM 接线为下一阶段任务）' });
    sending.value = false;
    scrollToBottom();
  }, 600);
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}
</script>

<template>
  <div ref="chatEl" class="chat">
    <header class="chat-header">
      <button class="btn ghost" @click="backToHome"><Icon name="back" /> 返回首页</button>
      <h2><Icon name="sparkle" /> AI 助手</h2>
      <span class="chat-hint">对话 · 创作 · 问答</span>
    </header>
    <div ref="messagesEl" class="chat-messages">
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div class="msg-content">{{ m.content }}</div>
      </div>
      <div v-if="sending" class="msg assistant">
        <div class="msg-content loading-text">思考中…</div>
      </div>
    </div>
    <div class="chat-input-bar">
      <input
        v-model="input"
        class="chat-input"
        type="text"
        placeholder="有什么可以帮您？"
        :disabled="sending"
        @keydown.enter="send"
      />
      <button class="btn primary chat-send" :disabled="sending || !input.trim()" @click="send">
        <Icon name="send" /> 发送
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat {
  height: 100%;
  display: flex;
  flex-direction: column;
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
  /* 飞入由共享元素变换（FLIP）接管：挂载时从入口卡片矩形扩张到全屏（见 script）。
     此动画同时覆盖应用外壳的通用 view-in 入场（仅动 box-shadow，不与 FLIP 的 transform 冲突）。
     落地瞬间金色辉光一拍，强化『框长成页面』的落点感 */
  will-change: transform;
  animation: chat-land-glow 0.9s ease 0.3s both;
}
@keyframes chat-land-glow {
  0% { box-shadow: 0 0 0 0 rgba(212, 161, 44, 0); }
  35% { box-shadow: 0 0 46px rgba(212, 161, 44, 0.22); }
  100% { box-shadow: 0 0 0 0 rgba(212, 161, 44, 0); }
}
.chat-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: calc(var(--bar-h, 48px) + 16px) 16px 12px;
  /* 分层编排①：头部自上而下落位 */
  animation: chat-drop-in 0.5s cubic-bezier(0.22, 1.2, 0.36, 1) 0.1s both;
}
.chat-header h2 {
  margin: 0;
  font-size: 18px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.chat-hint {
  color: var(--text-dim);
  font-size: 13px;
}
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* 分层编排②：消息区随后上浮显现 */
  animation: chat-rise-in 0.5s cubic-bezier(0.22, 1.2, 0.36, 1) 0.2s both;
}
.chat-messages .msg {
  max-width: 78%;
  animation: msg-in 0.32s ease both;
}
.chat-messages .msg.user {
  align-self: flex-end;
}
.chat-messages .msg.assistant {
  align-self: flex-start;
}
.chat-messages .msg.user .msg-content {
  background: rgba(212, 161, 44, 0.12);
  border: 1px solid rgba(212, 161, 44, 0.3);
}
.chat-messages .msg.assistant .msg-content {
  background: var(--panel-2);
  border: 1px solid var(--border);
}
.chat-messages .msg-content {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
}
.loading-text {
  color: var(--text-dim);
}
.chat-input-bar {
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  /* 分层编排③：输入栏最后弹起落位，节奏收尾 */
  animation: chat-rise-in 0.5s cubic-bezier(0.22, 1.2, 0.36, 1) 0.3s both;
}
.chat-input {
  flex: 1;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.chat-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(212, 161, 44, 0.15);
}
.chat-input::placeholder {
  color: var(--text-dim);
}
.chat-send {
  flex-shrink: 0;
}
@keyframes msg-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
@keyframes chat-drop-in {
  from { opacity: 0; transform: translateY(-14px); }
  to { opacity: 1; transform: none; }
}
@keyframes chat-rise-in {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: none; }
}
</style>
