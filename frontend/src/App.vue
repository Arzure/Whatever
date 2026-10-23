<script setup>
import { onMounted, provide, ref, computed, watch, defineAsyncComponent } from 'vue';
import { useGame } from './composables/useGame';
import { getAuthToken, getAuthUser, setAuth, api } from './api';
import SilkBackground from './components/SilkBackground.vue';
// —— 视图懒加载：各页面拆成独立分包，进入时才下载，首屏不背全站代码 ——
const HomeView = defineAsyncComponent(() => import('./components/HomeView.vue'));
const WorldView = defineAsyncComponent(() => import('./components/WorldView.vue'));
const DetectiveView = defineAsyncComponent(() => import('./components/DetectiveView.vue'));
const WolfView = defineAsyncComponent(() => import('./components/WolfView.vue'));
const DeductionView = defineAsyncComponent(() => import('./components/DeductionView.vue'));
const DrawView = defineAsyncComponent(() => import('./components/DrawView.vue'));
const OfficeView = defineAsyncComponent(() => import('./components/OfficeView.vue'));
const AdminView = defineAsyncComponent(() => import('./components/AdminView.vue'));
const AdventureView = defineAsyncComponent(() => import('./components/AdventureView.vue'));
const ChatView = defineAsyncComponent(() => import('./components/ChatView.vue'));
const GameView = defineAsyncComponent(() => import('./components/GameView.vue'));
const GameHubView = defineAsyncComponent(() => import('./components/GameHubView.vue'));
const VoxelView = defineAsyncComponent(() => import('./components/VoxelView.vue'));
const IronholdView = defineAsyncComponent(() => import('./components/IronholdView.vue'));
const JungleView = defineAsyncComponent(() => import('./components/JungleView.vue'));
import AccessGate from './components/AccessGate.vue';
import LoginView from './components/LoginView.vue';
import AccountSettings from './components/AccountSettings.vue';
import Icon from './components/Icon.vue';

const game = useGame();
provide('game', game);

// —— 主题切换（深色定稿 / 浅色对比）：选择存 localStorage，刷新后保持 ——
const theme = ref(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'); // 默认浅色，用户切换后按保存的偏好
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
// —— 顶栏高度同步：顶栏固定悬浮后，用 CSS 变量给各视图滚动容器让位（手机端换行高度自适应） ——
const barEl = ref(null);
// —— 顶栏滚动阴影：任一滚动容器下移后顶栏底部阴影渐显 ——
const barScrolled = ref(false);
function onAnyScroll(e) {
  const t = e.target;
  const top = (t === document || t === window || t === document.body) ? (window.scrollY || 0) : (t.scrollTop || 0);
  barScrolled.value = top > 8;
}
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
  // 全局滚动监听（捕获阶段）：捕捉各视图内部滚动容器的滚动位置，驱动顶栏阴影
  document.addEventListener('scroll', onAnyScroll, true);
});

// 顶栏固定悬浮：内容从顶栏下方穿过，毛玻璃才有可模糊的滚动内容；顶栏登录后才渲染，侦听其出现后建立高度同步（换行时 ResizeObserver 自适应）
watch(barEl, (el) => {
  if (!el) return;
  const syncBarH = () => document.documentElement.style.setProperty('--bar-h', el.offsetHeight + 'px');
  syncBarH();
  new ResizeObserver(syncBarH).observe(el);
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
// —— 返回上一级：全站统一层级映射（顶栏『<』按钮唯一入口） ——
// 游戏中心 → 首页；挥剑挑战/方块世界 → 游戏中心；文字冒险游戏进行中 → 文字冒险模式页；其余视图 → 首页
function backUp() {
  const v = game.state.view;
  if (v === 'game' || v === 'voxel' || v === 'ironhold' || v === 'jungle') {
    game.state.view = 'hub';
  } else if (v === 'story') {
    game.state.view = 'adventure';
  } else {
    game.backToHome();
  }
}
</script>
<template>
  <AccessGate>
    <div v-if="authChecking" class="auth-loading">正在检查登录状态…</div>
    <LoginView v-else-if="!authUser" @logged-in="onLoggedIn" />
    <template v-else>
      <div class="app-shell">
        <!-- 绸缎背景上移至外壳层：首页与对话页共享同一实例，飞入过渡时背景全程连续不闪断；
             对话页下叠加模糊滤镜（类由全局样式接管），降低背景对阅读的干扰 -->
        <SilkBackground v-if="game.state.view === 'home' || game.state.view === 'hub' || game.state.view === 'chat'" :class="{ 'silk-dimmed': game.state.view === 'chat' }" />
        <header ref="barEl" class="app-bar" :class="{ scrolled: barScrolled }">
          <button v-if="game.state.view !== 'home'" class="app-bar-home" title="返回首页" @click="game.backToHome"><Icon name="home" /> <span class="bar-label">首页</span></button>
          <!-- 返回上一级：非首页时始终显示，全站唯一的层级返回入口 -->
          <button v-if="game.state.view !== 'home'" class="app-bar-back" title="返回上一级" @click="backUp">‹</button>
          <span class="app-bar-user" :title="authUser.username"><Icon name="user" /> {{ displayUsername }}</span>
          <button class="app-bar-logout" :title="theme === 'light' ? '切换到深色主题' : '切换到浅色主题'" @click="toggleTheme"><Icon :name="theme === 'light' ? 'moon' : 'sun'" /> <span class="bar-label">{{ theme === 'light' ? '深色' : '浅色' }}</span></button>
          <button v-if="authUser?.isAdmin" class="app-bar-logout" title="管理" @click="game.state.view = 'admin'"><Icon name="admin" /> <span class="bar-label">管理</span></button>
          <button class="app-bar-logout" @click="showSettings = true"><Icon name="settings" /> <span class="label-full">账号设置</span><span class="label-short">设置</span></button>
        </header>
        <div class="app-body">
          <HomeView v-if="game.state.view === 'home'" />
          <!-- 具体页面视图优先于游戏模式判断：避免返回首页后 mode 残留导致绘图/办公/管理页面被游戏界面遮挡 -->
          <DrawView v-else-if="game.state.view === 'draw'" />
          <OfficeView v-else-if="game.state.view === 'office'" />
          <AdminView v-else-if="game.state.view === 'admin'" />
          <AdventureView v-else-if="game.state.view === 'adventure'" />
          <ChatView v-else-if="game.state.view === 'chat'" />
          <GameView v-else-if="game.state.view === 'game'" />
          <GameHubView v-else-if="game.state.view === 'hub'" />
          <VoxelView v-else-if="game.state.view === 'voxel'" />
          <IronholdView v-else-if="game.state.view === 'ironhold'" />
          <JungleView v-else-if="game.state.view === 'jungle'" />
          <DetectiveView v-else-if="game.state.mode === 'detective'" />
          <WolfView v-else-if="game.state.mode === 'wolf'" />
          <DeductionView v-else-if="game.state.mode === 'deduction'" />
          <WorldView v-else />
        </div>
      </div>
      <AccountSettings v-if="showSettings" :user="authUser" @close="showSettings = false" @renamed="onRenamed" @deleted="onDeleted" @logout="showSettings = false; logout()" />
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
  /* 不加让位内边距：各视图滚动容器自行让位（padding 在滚动区内），内容滚动时从毛玻璃顶栏后方穿过 */
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
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 70; /* 悬浮于内容之上：内容从下方穿过，毛玻璃才能模糊滚动内容 */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 8px 16px;
  /* 毛玻璃顶栏：深蓝紫半透明底 + 强模糊 + 金色亮边，与内容形成清晰层次 */
  background: rgba(19, 26, 46, 0.55);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border-bottom: 1px solid rgba(212, 161, 44, 0.22);
  box-shadow: 0 1px 0 rgba(212, 161, 44, 0.1), 0 6px 28px rgba(0, 0, 0, 0.35);
  transition: box-shadow 0.3s ease;
}
/* 滚动后顶栏：底部阴影渐变加深，强化内容悬浮层次 */
.app-bar.scrolled {
  box-shadow: 0 1px 0 rgba(212, 161, 44, 0.12), 0 2px 10px rgba(0, 0, 0, 0.3), 0 12px 36px rgba(0, 0, 0, 0.48);
}
.app-bar-user {
  color: #e6edf3;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
/* 游戏内返回游戏中心：仅『<』字样，紧贴首页按钮右侧，接管右侧弹性间距 */
.app-bar-back {
  margin-right: auto; /* 承担弹性间距：首页+返回两按钮紧邻左侧，用户名等推到右侧 */
  padding: 4px 12px;
  border: 1px solid #3d4d80;
  border-radius: 6px;
  background: #1f2b52;
  color: #e6edf3;
  font-size: 13px;
  line-height: 16px; /* 行高对齐首页按钮的图标高度（16px），按钮上下方向等高 */
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: border-color 0.2s, color 0.2s;
}
.app-bar-back:hover {
  border-color: #58a6ff;
  color: #58a6ff;
}
.app-bar-home {
  /* 弹性间距移至『<』按钮：两按钮紧邻左侧，其余元素推到右侧 */
  padding: 4px 12px;
  border: 1px solid #3d4d80;
  border-radius: 6px;
  background: #1f2b52;
  color: #e6edf3;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.app-bar-home:hover {
  border-color: #58a6ff;
  color: #58a6ff;
}

.app-bar-logout {
  background: none;
  border: 1px solid #3d4d80;
  border-radius: 6px;
  color: #8b949e;
  font-size: 13px;
  padding: 4px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.app-bar-logout:hover {
  color: #f85149;
  border-color: #f85149;
}
/* —— 浅色主题顶栏适配：白色毛玻璃 + 紫色亮边，避免深蓝顶栏在浅色页面割裂 —— */
html.light .app-bar {
  /* 底色不透明度 0.15（按用户要求逐轮调低）；模糊强度与深色一致，不单独加强 */
  background: rgba(255, 255, 255, 0.15);
  border-bottom: 1px solid rgba(109, 90, 224, 0.28);
  box-shadow: 0 1px 0 rgba(109, 90, 224, 0.08), 0 6px 28px rgba(30, 38, 56, 0.1);
}
html.light .app-bar.scrolled {
  box-shadow: 0 1px 0 rgba(109, 90, 224, 0.1), 0 2px 8px rgba(30, 38, 56, 0.1), 0 12px 32px rgba(30, 38, 56, 0.18);
}
html.light .app-bar-user {
  color: #1e2638;
}
html.light .app-bar-home {
  background: #eef1f8;
  border-color: #d8deeb;
  color: #1e2638;
}
html.light .app-bar-back {
  background: #eef1f8;
  border-color: #d8deeb;
  color: #1e2638;
}
html.light .app-bar-back:hover {
  border-color: #6d5ae0;
  color: #6d5ae0;
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
/* 窄屏顶栏纯图标化：隐藏全部文字标签与用户名，六个图标按钮单行放得下，不再换行成两行 */
@media (max-width: 480px) {
  .bar-label,
  .label-short,
  .app-bar-user {
    display: none;
  }
  .app-bar {
    gap: 4px;
    padding: 6px 6px;
  }
}
</style>
