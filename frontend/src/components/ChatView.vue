<script setup>
import { ref, nextTick, inject, onMounted } from 'vue';
import Icon from './Icon.vue';
import { api } from '../api';

const { state, backToHome } = inject('game');

// —— 会话与消息（真实接口：持久化到后端） ——
const sessions = ref([]);
const sessionId = ref('');
const messages = ref([]);
const input = ref('');
const sending = ref(false);
const loadingSession = ref(false);
const sidebarOpen = ref(true); // 侧栏默认展开，可折叠
const messagesEl = ref(null);

// —— 共享元素飞入（FLIP）：挂载时从首页入口卡片的屏幕位置/尺寸平滑扩张成整个对话页 ——
const chatEl = ref(null);
onMounted(async () => {
  const el = chatEl.value;
  const from = state.chatRect;
  if (el && from) {
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
  }
  await loadSessions();
  await newSession();
});

// 会话列表
async function loadSessions() {
  try {
    const data = await api.chatSessions();
    sessions.value = data.rows || [];
  } catch (e) {
    console.error('[chat] 会话列表加载失败:', e.message);
  }
}

// 新建会话
async function newSession() {
  if (sending.value) return;
  sessionId.value = '';
  messages.value = [];
  try {
    const s = await api.chatNewSession();
    sessionId.value = s.id;
    sessions.value.unshift({ id: s.id, title: s.title, created_at: s.createdAt, updated_at: s.updatedAt });
  } catch (e) {
    console.error('[chat] 新建会话失败:', e.message);
  }
}

// 切换到历史会话
async function openSession(id) {
  if (sending.value || id === sessionId.value) return;
  loadingSession.value = true;
  try {
    const data = await api.chatSession(id);
    sessionId.value = data.session.id;
    messages.value = (data.messages || []).map((m) => ({ role: m.role, content: m.content }));
    scrollToBottom();
  } catch (e) {
    console.error('[chat] 会话加载失败:', e.message);
  } finally {
    loadingSession.value = false;
  }
}

// 删除会话
async function removeSession(id) {
  if (sending.value) return;
  if (!confirm('确定删除这个会话吗？删除后不可恢复。')) return;
  try {
    await api.chatDelete(id);
    sessions.value = sessions.value.filter((s) => s.id !== id);
    if (id === sessionId.value) await newSession();
  } catch (e) {
    console.error('[chat] 会话删除失败:', e.message);
  }
}

// 发送消息：真实接口，回复落库
async function send() {
  const text = input.value.trim();
  if (!text || sending.value || !sessionId.value) return;
  messages.value.push({ role: 'user', content: text });
  input.value = '';
  sending.value = true;
  scrollToBottom();
  try {
    const data = await api.chatSend(sessionId.value, text);
    messages.value.push({ role: 'assistant', content: data.reply.content });
    // 刷新侧栏标题（首条消息自动生成）
    const s = sessions.value.find((x) => x.id === sessionId.value);
    if (s && s.title === '新对话') {
      s.title = text.slice(0, 20);
      s.updated_at = Date.now();
    }
  } catch (e) {
    messages.value.push({ role: 'assistant', content: `回复失败：${e.message}，请稍后重试。` });
  } finally {
    sending.value = false;
    scrollToBottom();
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div ref="chatEl" class="chat">
    <!-- 可折叠会话侧栏 -->
    <aside class="chat-sidebar" :class="{ collapsed: !sidebarOpen }">
      <button class="sidebar-toggle" :title="sidebarOpen ? '收起侧栏' : '展开侧栏'" @click="sidebarOpen = !sidebarOpen">
        <Icon :name="sidebarOpen ? 'back' : 'menu'" :size="16" />
      </button>
      <template v-if="sidebarOpen">
        <button class="btn primary sidebar-new" @click="newSession"><Icon name="sparkle" :size="14" /> 新对话</button>
        <div class="sidebar-list">
          <div v-if="!sessions.length" class="sidebar-empty">暂无历史会话</div>
          <div
            v-for="s in sessions"
            :key="s.id"
            class="sidebar-item"
            :class="{ active: s.id === sessionId }"
            @click="openSession(s.id)"
          >
            <span class="sidebar-item-title">{{ s.title }}</span>
            <span class="sidebar-item-time">{{ fmtTime(s.updated_at) }}</span>
            <button class="sidebar-item-del" title="删除会话" @click.stop="removeSession(s.id)">×</button>
          </div>
        </div>
      </template>
    </aside>
    <!-- 主对话区 -->
    <div class="chat-main">
      <header class="chat-header">
        <button class="btn ghost" @click="backToHome"><Icon name="back" /> 返回首页</button>
        <h2><Icon name="sparkle" /> AI 助手</h2>
        <span class="chat-hint">对话 · 创作 · 问答</span>
      </header>
      <div ref="messagesEl" class="chat-messages">
        <div v-if="loadingSession" class="msg assistant"><div class="msg-content loading-text">加载中…</div></div>
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
  </div>
</template>

<style scoped>
.chat {
  height: 100%;
  display: flex;
  max-width: 1080px;
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
/* —— 可折叠会话侧栏 —— */
.chat-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: calc(var(--bar-h, 48px) + 16px) 10px 12px;
  border-right: 1px solid var(--border);
  overflow: hidden;
  transition: width 0.32s cubic-bezier(0.22, 1.2, 0.36, 1), padding 0.32s ease;
}
.chat-sidebar.collapsed {
  width: 44px;
  padding-left: 6px;
  padding-right: 6px;
  border-right-color: transparent;
}
.sidebar-toggle {
  align-self: flex-end;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, border-color 0.15s;
}
.chat-sidebar.collapsed .sidebar-toggle {
  align-self: center;
}
.sidebar-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.sidebar-new {
  white-space: nowrap;
}
.sidebar-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sidebar-empty {
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}
.sidebar-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.sidebar-item:hover {
  background: var(--panel-2);
}
.sidebar-item.active {
  background: var(--panel-2);
  border-color: var(--accent);
}
.sidebar-item-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 18px;
}
.sidebar-item-time {
  font-size: 11px;
  color: var(--text-dim);
}
.sidebar-item-del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}
.sidebar-item:hover .sidebar-item-del {
  opacity: 1;
}
.sidebar-item-del:hover {
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.1);
}
/* —— 主对话区 —— */
.chat-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
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
/* 移动端：侧栏默认收窄，避免挤占消息区 */
@media (max-width: 640px) {
  .chat-sidebar {
    width: 44px;
    padding-left: 6px;
    padding-right: 6px;
    border-right-color: transparent;
  }
  .chat-sidebar .sidebar-toggle {
    align-self: center;
  }
}
</style>
