<script setup>
import { onMounted, provide, ref } from 'vue';
import { useGame } from './composables/useGame';
import { getAuthToken, getAuthUser, setAuth, api } from './api';
import HomeView from './components/HomeView.vue';
import WorldView from './components/WorldView.vue';
import DetectiveView from './components/DetectiveView.vue';
import WolfView from './components/WolfView.vue';
import DeductionView from './components/DeductionView.vue';
import AccessGate from './components/AccessGate.vue';
import LoginView from './components/LoginView.vue';
import AccountSettings from './components/AccountSettings.vue';

const game = useGame();
provide('game', game);

// —— 玩家登录状态 ——
const authUser = ref(getAuthToken() ? getAuthUser() : null);
const authChecking = ref(!!getAuthToken());

onMounted(async () => {
  // 有本地令牌时先向后端校验有效性，过期则清除并回到登录页
  if (getAuthToken()) {
    try {
      const { user } = await api.me();
      authUser.value = user;
    } catch {
      setAuth('', null);
      authUser.value = null;
    } finally {
      authChecking.value = false;
    }
  }
  if (authUser.value) game.refreshSaves();
});

function onLoggedIn(user) {
  authUser.value = user;
  game.refreshSaves();
}

function logout() {
  setAuth('', null);
  authUser.value = null;
}

// —— 账号设置 ——
const showSettings = ref(false);
function onRenamed(user) {
  authUser.value = user;
}
function onDeleted() {
  showSettings.value = false;
  authUser.value = null;
}
// —— 存档选择浮层（顶栏入口，与账号设置/退出登录同栏） ——
const showSaves = ref(false);
const deletingId = ref('');
const deletingAll = ref(false);
async function deleteAllSaves() {
  if (deletingAll.value || deletingId.value) return;
  const n = game.state.saves.length;
  if (!n) return;
  if (!confirm(`确定清空全部 ${n} 个存档吗？此操作不可恢复，且只影响当前账号。`)) return;
  deletingAll.value = true;
  game.state.error = '';
  try {
    await api.deleteAllSaves();
    await game.refreshSaves();
  } catch (e) {
    game.state.error = e.message;
  } finally {
    deletingAll.value = false;
  }
}
async function deleteSave(s) {
  if (deletingId.value) return;
  if (!confirm(`确定删除存档「${s.playerName}」吗？此操作不可恢复。`)) return;
  deletingId.value = s.id;
  game.state.error = '';
  try {
    await api.deleteSave(s.id);
    await game.refreshSaves();
  } catch (e) {
    game.state.error = e.message;
  } finally {
    deletingId.value = '';
  }
}
</script>
<template>
  <AccessGate>
    <div v-if="authChecking" class="auth-loading">正在检查登录状态…</div>
    <LoginView v-else-if="!authUser" @logged-in="onLoggedIn" />
    <template v-else>
      <div class="app-shell">
        <header class="app-bar">
          <button v-if="game.state.view !== 'home'" class="app-bar-home" title="返回首页" @click="game.backToHome">🏠 首页</button>
          <span class="app-bar-user">👤 {{ authUser.username }}</span>
          <button class="app-bar-logout" @click="showSaves = true">📂 存档</button>
          <button class="app-bar-logout" @click="showSettings = true">账号设置</button>
          <button class="app-bar-logout" @click="logout">退出登录</button>
        </header>
        <div class="app-body">
          <HomeView v-if="game.state.view === 'home'" />
          <DetectiveView v-else-if="game.state.mode === 'detective'" />
          <WolfView v-else-if="game.state.mode === 'wolf'" />
          <DeductionView v-else-if="game.state.mode === 'deduction'" />
          <WorldView v-else />
        </div>
      </div>
      <AccountSettings v-if="showSettings" :user="authUser" @close="showSettings = false" @renamed="onRenamed" @deleted="onDeleted" />
      <!-- 存档选择浮层（顶栏入口） -->
      <Transition name="ovl">
        <div v-if="showSaves" class="save-overlay" @click.self="showSaves = false">
          <div class="save-modal">
            <div class="save-modal-head">
              <h3>📂 继续冒险</h3>
              <button class="save-modal-close" @click="showSaves = false">✕</button>
            </div>
            <div class="save-modal-body">
              <div v-for="s in game.state.saves" :key="s.id" class="save-item" @click="showSaves = false; game.loadSave(s.id)">
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
                {{ deletingAll ? '清空中…' : `🗑 清空全部存档（${game.state.saves.length}）` }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </template>
  </AccessGate>
</template>

<style scoped>
.auth-loading {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8b949e;
  font-size: 14px;
}
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.app-body {
  flex: 1;
  min-height: 0; /* 关键：允许子元素在 flex 容器内正确计算高度，避免超出视口 */
  position: relative;
}
.app-body > * {
  height: 100%;
}
.app-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 8px 16px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}
.app-bar-user {
  color: #e6edf3;
  font-size: 14px;
}
.app-bar-home {
  margin-right: auto;
  padding: 4px 12px;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #21262d;
  color: #e6edf3;
  font-size: 13px;
  cursor: pointer;
}
.app-bar-home:hover {
  border-color: #58a6ff;
  color: #58a6ff;
}
/* —— 存档选择浮层（顶栏入口，样式与原首页浮层一致） —— */
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
.save-modal-head h3 {
  margin: 0;
  font-size: 15px;
}
.save-modal-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
}
.save-modal-body {
  overflow-y: auto;
  padding: 12px 16px;
}
.save-modal-body .save-item {
  margin-bottom: 8px;
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
.app-bar-logout {
  background: none;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #8b949e;
  font-size: 13px;
  padding: 4px 10px;
  cursor: pointer;
}
.app-bar-logout:hover {
  color: #f85149;
  border-color: #f85149;
}
/* 手机端顶栏：隐藏用户名 + 收紧间距，按钮紧凑单行不换行 */
@media (max-width: 768px) {
  .app-bar {
    gap: 6px;
    padding: 6px 8px;
  }
  .app-bar-user {
    display: none;
  }
  .app-bar-home,
  .app-bar-logout {
    padding: 4px 8px;
    font-size: 12px;
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
