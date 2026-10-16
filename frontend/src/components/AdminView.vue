<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

// 管理员界面（第一期：用户管理）——仅管理员可见（顶栏入口由父组件控制）
const rows = ref([]);
const error = ref('');
const loading = ref(false);
// 删除确认状态：待删用户 + 输入的用户名确认
const deleteTarget = ref(null);
const deleteConfirmName = ref('');
// 重置密码状态：目标用户 + 新密码
const resetTarget = ref(null);
const newPassword = ref('');
// 在线历史状态：目标用户 + 会话列表
const sessionTarget = ref(null);
const sessionRows = ref([]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.adminUsers();
    rows.value = r.rows || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// 查看用户在线历史
async function showSessions(r) {
  sessionTarget.value = r;
  sessionRows.value = [];
  try {
    const res = await api.adminUserSessions(r.id);
    sessionRows.value = res.rows || [];
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);

function fmt(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// 最近活跃：存档与绘图的最新时间取大者，无则注册时间
function lastActive(r) {
  const t = Math.max(r.last_save_at || 0, r.last_draw_at || 0, r.created_at || 0);
  return fmt(t);
}

async function doDelete() {
  if (!deleteTarget.value) return;
  if (deleteConfirmName.value !== deleteTarget.value.username) {
    error.value = '输入的用户名不一致，已取消删除';
    return;
  }
  try {
    await api.adminDeleteUser(deleteTarget.value.id);
    deleteTarget.value = null;
    deleteConfirmName.value = '';
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

async function doReset() {
  if (!resetTarget.value) return;
  if (newPassword.value.length < 6) {
    error.value = '新密码至少 6 位';
    return;
  }
  try {
    await api.adminResetPassword(resetTarget.value.id, newPassword.value);
    resetTarget.value = null;
    newPassword.value = '';
    error.value = '';
  } catch (e) {
    error.value = e.message;
  }
}
</script>

<template>
  <div class="admin">
    <header class="admin-header">
      <button class="back" @click="$emit('back')">‹ 返回</button>
      <h2>🛡 用户管理</h2>
      <button class="refresh" @click="load">刷新</button>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <div v-if="rows.length" class="user-table">
      <div class="table-head row">
        <span>用户名</span><span>状态</span><span>注册时间</span><span>存档</span><span>绘图</span><span>最近活跃</span><span>操作</span>
      </div>
      <div v-for="r in rows" :key="r.id" class="row" :class="{ admin: r.is_admin }">
        <span class="name">{{ r.username }}{{ r.is_admin ? ' 🛡' : '' }}</span>
        <span><i class="dot" :class="r.online ? 'on' : 'off'"></i>{{ r.online ? '在线' : '离线' }}</span>
        <span>{{ fmt(r.created_at) }}</span>
        <span>{{ r.save_count }}</span>
        <span>{{ r.draw_count }}</span>
        <span>{{ lastActive(r) }}</span>
        <span class="ops">
          <button class="op" @click="showSessions(r)">在线历史</button>
          <button class="op" @click="resetTarget = r">重置密码</button>
          <button v-if="!r.is_admin" class="op danger" @click="deleteTarget = r; deleteConfirmName = ''">删除</button>
        </span>
      </div>
    </div>
    <p v-else-if="!loading" class="hint">暂无用户</p>

    <!-- 删除确认浮层：输入用户名二次确认 -->
    <div v-if="deleteTarget" class="overlay" @click.self="deleteTarget = null">
      <div class="modal">
        <h3>删除用户「{{ deleteTarget.username }}」</h3>
        <p class="warn">将级联删除其全部存档、绘图历史与提示词，不可恢复。</p>
        <p class="warn">请输入用户名 <b>{{ deleteTarget.username }}</b> 确认：</p>
        <input v-model="deleteConfirmName" class="input" placeholder="输入用户名确认" />
        <div class="modal-ops">
          <button class="op danger" @click="doDelete">确认删除</button>
          <button class="op" @click="deleteTarget = null">取消</button>
        </div>
      </div>
    </div>

    <!-- 重置密码浮层 -->
    <div v-if="resetTarget" class="overlay" @click.self="resetTarget = null">
      <div class="modal">
        <h3>重置「{{ resetTarget.username }}」的密码</h3>
        <input v-model="newPassword" class="input" type="password" placeholder="新密码（6-64 位）" maxlength="64" />
        <div class="modal-ops">
          <button class="op" @click="doReset">确认重置</button>
          <button class="op" @click="resetTarget = null">取消</button>
        </div>
      </div>
    </div>

    <!-- 在线历史浮层 -->
    <div v-if="sessionTarget" class="overlay" @click.self="sessionTarget = null">
      <div class="modal sessions">
        <h3>「{{ sessionTarget.username }}」的在线历史</h3>
        <p v-if="!sessionRows.length" class="warn">暂无记录</p>
        <div v-else class="session-list">
          <div v-for="(s, i) in sessionRows" :key="i" class="session-row">
            <span>上线 {{ fmt(s.login_at) }}</span>
            <span>最后活跃 {{ fmt(s.last_active_at) }}</span>
          </div>
        </div>
        <div class="modal-ops">
          <button class="op" @click="sessionTarget = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin {
  max-width: 860px;
  margin: 0 auto;
  padding: 20px 16px 60px;
}
.admin-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.admin-header h2 {
  margin: 0;
  font-size: 20px;
  flex: 1;
}
.back, .refresh {
  background: none;
  border: 1px solid var(--border, #444);
  color: var(--text, #eee);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.back:hover, .refresh:hover {
  opacity: 0.8;
}
.error {
  color: #ff7d7d;
  font-size: 13px;
  margin: 12px 0;
}
.hint {
  color: var(--text-dim);
  font-size: 13px;
  text-align: center;
  padding: 40px 0;
}
.user-table {
  border: 1px solid var(--border, #444);
  border-radius: 12px;
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 1.3fr 0.8fr 1.1fr 0.5fr 0.5fr 1.1fr 1.8fr;
  gap: 8px;
  align-items: center;
  padding: 10px 14px;
  font-size: 13px;
  border-bottom: 1px solid var(--border, #333);
}
.row:last-child {
  border-bottom: none;
}
.table-head {
  background: rgba(0, 0, 0, 0.3);
  color: var(--text-dim);
  font-size: 12px;
}
.row.admin {
  background: rgba(124, 108, 240, 0.08);
}
.name {
  font-weight: 600;
}
.ops {
  display: flex;
  gap: 6px;
}
.op {
  background: none;
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  color: var(--text, #eee);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}
.op:hover {
  border-color: #7c6cf0;
}
.op.danger {
  color: #ff7d7d;
}
.op.danger:hover {
  border-color: #ff7d7d;
}
/* 浮层 */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.modal {
  background: var(--panel, #1e1e24);
  border: 1px solid var(--border, #444);
  border-radius: 12px;
  padding: 20px;
  width: min(380px, 90vw);
}
.modal h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.warn {
  color: var(--text-dim);
  font-size: 13px;
  margin: 8px 0;
}
.input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  color: var(--text, #eee);
  padding: 8px 12px;
  font-size: 14px;
  margin-top: 6px;
}
.modal-ops {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  justify-content: flex-end;
}
/* 在线状态圆点 */
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
}
.dot.on {
  background: #3fb950;
  box-shadow: 0 0 4px #3fb950;
}
.dot.off {
  background: #666;
}
/* 在线历史列表 */
.modal.sessions {
  width: min(440px, 92vw);
}
.session-list {
  max-height: 320px;
  overflow-y: auto;
}
.session-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-dim);
  padding: 6px 0;
  border-bottom: 1px solid var(--border, #333);
}
.session-row:last-child {
  border-bottom: none;
}
</style>
