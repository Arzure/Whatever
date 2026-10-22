<script setup>
import { onMounted, provide, ref, computed } from 'vue';
import { useGame } from './composables/useGame';
import { getAuthToken, getAuthUser, setAuth, api } from './api';
import HomeView from './components/HomeView.vue';
import WorldView from './components/WorldView.vue';
import DetectiveView from './components/DetectiveView.vue';
import WolfView from './components/WolfView.vue';
import DeductionView from './components/DeductionView.vue';
import DrawView from './components/DrawView.vue';
import OfficeView from './components/OfficeView.vue';
import AdminView from './components/AdminView.vue';
import AdventureView from './components/AdventureView.vue';
import AccessGate from './components/AccessGate.vue';
import LoginView from './components/LoginView.vue';
import AccountSettings from './components/AccountSettings.vue';

const game = useGame();
provide('game', game);

// —— 主题切换（深色定稿 / 浅色对比）：选择存 localStorage，刷新后保持 ——
const theme = ref(localStorage.getItem('theme') === 'light' ? 'light' : 'dark');
function applyTheme() {
  document.documentElement.classList.toggle('light', theme.value === 'light');
}
function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', theme.value);
  applyTheme();
}
applyTheme();

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

// 顶栏用户名：超长截断（最多 5 个字符，超出以省略号显示，完整名悬停可见）
const displayUsername = computed(() => {
  const n = authUser.value?.username || '';
  return n.length > 5 ? n.slice(0, 5) + '…' : n;
});
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
          <span class="app-bar-user" :title="authUser.username">👤 {{ displayUsername }}</span>
          <button class="app-bar-logout" :title="theme === 'light' ? '切换到深色主题' : '切换到浅色主题'" @click="toggleTheme">{{ theme === 'light' ? '🌙 深色' : '☀️ 浅色' }}</button>
          <button v-if="authUser?.isAdmin" class="app-bar-logout" @click="game.state.view = 'admin'">🛡 管理</button>
          <button class="app-bar-logout" @click="showSaves = true">📂 存档</button>
          <button class="app-bar-logout" @click="showSettings = true"><span class="label-full">账号设置</span><span class="label-short">设置</span></button>
        </header>
        <div class="app-body">
          <HomeView v-if="game.state.view === 'home'" />
          <DetectiveView v-else-if="game.state.mode === 'detective'" />
          <WolfView v-else-if="game.state.mode === 'wolf'" />
          <DeductionView v-else-if="game.state.mode === 'deduction'" />
          <DrawView v-else-if="game.state.view === 'draw'" />
          <OfficeView v-else-if="game.state.view === 'office'" @back="game.backToHome" />
          <AdminView v-else-if="game.state.view === 'admin'" @back="game.backToHome" />
          <AdventureView v-else-if="game.state.view === 'adventure'" @back="game.backToHome" />
          <WorldView v-else />
        </div>
      </div>
      <AccountSettings v-if="showSettings" :user="authUser" @close="showSettings = false" @renamed="onRenamed" @deleted="onDeleted" @logout="showSettings = false; logout()" />
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
  /* 页面切换入场：淡入 + 轻微上移，导航动效反馈 */
  animation: view-in 0.28s ease both;
}
@keyframes view-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 顶栏：自适应布局（通用方案）——空间不够时按钮组自动整齐换行，不依赖断点 */
.app-bar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 8px 16px;
  /* 毛玻璃顶栏：深蓝紫半透明底 + 强模糊 + 金色亮边，与内容形成清晰层次 */
  background: rgba(19, 26, 46, 0.65);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  border-bottom: 1px solid rgba(212, 161, 44, 0.22);
  box-shadow: 0 1px 0 rgba(212, 161, 44, 0.1), 0 6px 28px rgba(0, 0, 0, 0.35);
}
.app-bar-user {
  color: #e6edf3;
  font-size: 14px;
}
.app-bar-home {
  margin-right: auto;
  padding: 4px 12px;
  border: 1px solid #4a5c96;
  border-radius: 6px;
  background: #263566;
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
  padding: 10px 12px; /* 放宽纵向点击区域，手机端易点 */
  border: 1px solid var(--border); /* 边框环绕，条目更清晰 */
  border-radius: 8px;
  background: var(--panel-2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.save-modal-body .save-item:hover {
  border-color: var(--accent);
  background: rgba(212, 161, 44, 0.06);
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
  border: 1px solid #4a5c96;
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
/* —— 浅色主题顶栏适配：白色毛玻璃 + 紫色亮边，避免深蓝顶栏在浅色页面割裂 —— */
html.light .app-bar {
  background: rgba(255, 255, 255, 0.78);
  border-bottom: 1px solid rgba(109, 90, 224, 0.28);
  box-shadow: 0 1px 0 rgba(109, 90, 224, 0.08), 0 6px 28px rgba(30, 38, 56, 0.1);
}
html.light .app-bar-user {
  color: #1e2638;
}
html.light .app-bar-home {
  background: #eef1f8;
  border-color: #d8deeb;
  color: #1e2638;
}
html.light .app-bar-home:hover {
  border-color: #6d5ae0;
  color: #6d5ae0;
}
html.light .app-bar-logout {
  border-color: #d8deeb;
  color: #5b677e;
}
html.light .app-bar-logout:hover {
  color: #6d5ae0;
  border-color: #6d5ae0;
}
html.light .save-overlay {
  background: rgba(30, 38, 56, 0.35);
}
/* 手机端顶栏：隐藏用户名 + 收紧间距，按钮紧凑单行不换行 */
@media (max-width: 768px) {
  .app-bar {
    gap: 6px;
    padding: 6px 8px;
  }
  .app-bar-user {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 22vw; /* 长用户名截断显示，避免撑爆顶栏挤掉按钮 */
  }
  .app-bar-home,
  .app-bar-logout {
    padding: 4px 8px;
    font-size: 12px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  /* 账号设置按钮：窄屏缩短为『设置』，避免与其他按钮挤爆单行 */
  .label-full { display: none; }
  .label-short { display: inline; }
}
@media (min-width: 769px) {
  .label-full { display: inline; }
  .label-short { display: none; }
}
</style>
