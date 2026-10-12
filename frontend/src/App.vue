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
</script>
<template>
  <AccessGate>
    <div v-if="authChecking" class="auth-loading">正在检查登录状态…</div>
    <LoginView v-else-if="!authUser" @logged-in="onLoggedIn" />
    <template v-else>
      <header class="app-bar">
        <span class="app-bar-user">👤 {{ authUser.username }}</span>
        <button class="app-bar-logout" @click="logout">退出登录</button>
      </header>
      <HomeView v-if="game.state.view === 'home'" />
      <DetectiveView v-else-if="game.state.mode === 'detective'" />
      <WolfView v-else-if="game.state.mode === 'wolf'" />
      <DeductionView v-else-if="game.state.mode === 'deduction'" />
      <WorldView v-else />
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
.app-bar {
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
</style>
