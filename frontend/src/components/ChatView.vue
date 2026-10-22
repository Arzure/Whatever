<script setup>
import { ref, nextTick, inject, onMounted } from 'vue';
import Icon from './Icon.vue';
import { api, getAuthToken, getAccessToken } from '../api';
import { marked } from 'marked';

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
const reasoningOpen = ref({}); // 各消息思考区块的展开状态（流式时自动展开，完成后可点击切换）

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
  // 不自动新建会话：进入页面仅加载历史列表，发送首条消息时才创建（避免反复进出堆积空会话）
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

// 开始新对话：仅重置为未开始状态，真正创建发生在发送首条消息时
function newSession() {
  if (sending.value) return;
  sessionId.value = '';
  messages.value = [];
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

// 清空全部会话
async function clearAllSessions() {
  if (sending.value || !sessions.value.length) return;
  if (!confirm('确定清空全部对话记录吗？删除后不可恢复。')) return;
  try {
    await api.chatClearAll();
    sessions.value = [];
    sessionId.value = '';
    messages.value = [];
  } catch (e) {
    console.error('[chat] 清空失败:', e.message);
  }
}

// 发送消息：流式接口，逐字渲染+思考过程实时展示
async function send() {
  const text = input.value.trim();
  if (!text || sending.value) return;
  // 未开始的新对话：发送首条消息时才创建会话（标题由后端按首条消息自动生成）
  if (!sessionId.value) {
    try {
      const s = await api.chatNewSession();
      sessionId.value = s.id;
      sessions.value.unshift({ id: s.id, title: '新对话', created_at: s.createdAt, updated_at: s.updatedAt });
    } catch (e) {
      messages.value.push({ role: 'assistant', content: `创建会话失败：${e.message}` });
      return;
    }
  }
  messages.value.push({ role: 'user', content: text });
  input.value = '';
  sending.value = true;
  scrollToBottom();
  // 流式占位气泡（取代理对象，直接修改可触发更新）
  messages.value.push({ role: 'assistant', content: '', reasoning: '', streaming: true });
  const streamMsg = messages.value[messages.value.length - 1];
  try {
    const headers = { 'Content-Type': 'application/json' };
    const at = getAccessToken();
    if (at) headers['X-Access-Token'] = at;
    const t = getAuthToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch(`/api/chat/sessions/${sessionId.value}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    // SSE 解析：按空行分帧，提取 event/data
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop(); // 末帧可能不完整，留待下轮
      for (const frame of frames) {
        let event = '';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (!data) continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (event === 'delta') {
          streamMsg.content += j.content;
          scrollToBottom();
        } else if (event === 'reasoning') {
          streamMsg.reasoning += j.content;
        } else if (event === 'error') {
          streamMsg.content = j.error;
          streamMsg.failed = true;
        } else if (event === 'done') {
          streamMsg.content = j.reply.content; // 以落库的完整内容为准
        }
      }
    }
    // 刷新侧栏标题（首条消息自动生成）
    const s = sessions.value.find((x) => x.id === sessionId.value);
    if (s && s.title === '新对话') {
      s.title = text.slice(0, 20);
      s.updated_at = Date.now();
    }
  } catch (e) {
    streamMsg.content = `回复失败：${e.message}`;
    streamMsg.failed = true;
  } finally {
    streamMsg.streaming = false;
    sending.value = false;
    scrollToBottom();
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

// 助手消息渲染 Markdown（加粗/列表/代码等），与办公视图同款用法；用户消息保持纯文本防注入
function renderMd(text) {
  return marked.parse(String(text || ''));
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
        <button v-if="sessions.length" class="btn ghost sidebar-clear" title="清空全部对话" @click="clearAllSessions"><Icon name="trash" :size="14" /> 清空</button>
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
        <button class="chat-back" title="返回首页" @click="backToHome"><Icon name="home" :size="17" /></button>
        <h2><Icon name="sparkle" /> AI 助手</h2>
        <span class="chat-hint">对话 · 创作 · 问答</span>
      </header>
      <div ref="messagesEl" class="chat-messages">
        <div v-if="loadingSession" class="msg assistant"><div class="msg-content loading-text">加载中…</div></div>
        <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
          <div
            v-if="m.reasoning"
            class="msg-reasoning"
            :class="{ open: m.streaming || reasoningOpen[i] }"
            @click="reasoningOpen[i] = !reasoningOpen[i]"
          >
            <span class="reasoning-label"><Icon name="sparkle" :size="12" /> 思考过程</span>
            <div class="reasoning-body">{{ m.reasoning }}</div>
          </div>
          <div v-if="m.content || !m.streaming" class="msg-content" :class="{ md: m.role === 'assistant' && !m.failed }">
            <template v-if="m.role === 'assistant' && !m.failed"><span v-html="renderMd(m.content)"></span></template>
            <template v-else>{{ m.content }}</template>
            <span v-if="m.streaming" class="stream-cursor"></span>
          </div>
          <div v-else class="msg-content loading-text"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
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
  width: 100%; /* 全宽布局：侧栏贴合浏览器左缘，消息列单独限宽居中（参考 DeepSeek） */
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
  border-right: 1px solid transparent;
  border-image: linear-gradient(to bottom, transparent 4%, var(--border) 22%, var(--border) 78%, transparent 96%) 1;
  /* 毛玻璃：与主对话区形成质感区分，绸缎背景透出被模糊 */
  background: color-mix(in srgb, var(--panel) 52%, transparent);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
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
  /* 无框裸图标：与带边框的圆形返回按钮形成明显区分，避免误触 */
  align-self: flex-end;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: var(--text-dim);
  opacity: 0.7;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, opacity 0.15s;
}
.chat-sidebar.collapsed .sidebar-toggle {
  align-self: center;
}
.sidebar-toggle:hover {
  color: var(--accent);
  opacity: 1;
}
.sidebar-new {
  white-space: nowrap;
}
.sidebar-clear {
  white-space: nowrap;
  font-size: 12px;
  padding: 6px 10px;
}
.sidebar-clear:hover {
  color: #ff6b6b;
  border-color: #ff6b6b;
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
  /* 消息列限宽居中：宽屏下阅读舒适，不随浏览器无限拉宽（参考 DeepSeek） */
  max-width: 820px;
  width: 100%;
  margin: 0 auto;
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
  /* 柔和配色：面板底色+金色描边点缀，告别黄底黑字的刺眼感 */
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
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
/* 思考过程区块：流式时自动展开实时滚动，完成后折叠为标签可点击回看 */
.msg-reasoning {
  margin-bottom: 6px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
  padding: 4px 10px;
  cursor: pointer;
  user-select: none;
}
.reasoning-label {
  font-size: 12px;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.reasoning-body {
  display: none;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.6;
  white-space: pre-wrap;
  margin-top: 4px;
  user-select: text;
}
.msg-reasoning.open .reasoning-body {
  display: block;
}
/* 流式光标：金色竖线闪烁 */
.stream-cursor {
  display: inline-block;
  width: 2px;
  height: 14px;
  background: var(--accent);
  margin-left: 2px;
  vertical-align: -2px;
  animation: cursor-blink 0.9s steps(1) infinite;
}
@keyframes cursor-blink {
  50% { opacity: 0; }
}
/* 气泡内 Markdown 排版：列表/引用/代码等元素与气泡风格协调 */
.msg-content.md :deep(p) { margin: 0 0 8px; }
.msg-content.md :deep(p:last-child) { margin-bottom: 0; }
.msg-content.md :deep(ul), .msg-content.md :deep(ol) { margin: 4px 0 8px; padding-left: 20px; }
.msg-content.md :deep(li) { margin: 2px 0; }
.msg-content.md :deep(strong) { color: var(--accent); font-weight: 600; }
.msg-content.md :deep(h1), .msg-content.md :deep(h2), .msg-content.md :deep(h3) {
  margin: 10px 0 6px;
  font-size: 15px;
}
.msg-content.md :deep(blockquote) {
  margin: 6px 0;
  padding: 2px 10px;
  border-left: 2px solid var(--border);
  color: var(--text-dim);
}
.msg-content.md :deep(code) {
  background: color-mix(in srgb, var(--bg) 60%, transparent);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 13px;
}
.msg-content.md :deep(pre) {
  background: color-mix(in srgb, var(--bg) 75%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 6px 0;
}
.msg-content.md :deep(pre code) { background: none; padding: 0; }
.msg-content.md :deep(a) { color: var(--accent); }
.loading-text {
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
/* 思考中动效：三点依次跳动 */
.loading-text .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: dot-bounce 1.1s ease-in-out infinite;
}
.loading-text .dot:nth-child(2) { animation-delay: 0.18s; }
.loading-text .dot:nth-child(3) { animation-delay: 0.36s; }
@keyframes dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-5px); opacity: 1; }
}
.chat-input-bar {
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid transparent;
  border-image: linear-gradient(to right, transparent 2%, var(--border) 18%, var(--border) 82%, transparent 98%) 1;
  /* 输入栏与消息列同宽居中，视觉对齐 */
  max-width: 852px;
  width: 100%;
  margin: 0 auto;
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
/* 返回按钮：圆形图标按钮，悬停金色描边，替代生硬的幽灵按钮 */
.chat-back {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 60%, transparent);
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.18s, border-color 0.18s, transform 0.18s;
}
.chat-back:hover {
  color: var(--accent);
  border-color: var(--accent);
  transform: translateX(-2px);
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
  /* 头部紧凑化：隐藏副标题，缩小间距，保证单行完整显示 */
  .chat-hint {
    display: none;
  }
  .chat-header {
    gap: 10px;
    padding-top: calc(var(--bar-h, 48px) + 10px);
  }
  .chat-header h2 {
    font-size: 16px;
  }
}
</style>
