<script setup>
import { ref } from 'vue';
import { api, setAuth } from '../api';

const emit = defineEmits(['logged-in']);

const mode = ref('login'); // login | register
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

function switchMode(m) {
  mode.value = m;
  error.value = '';
}

async function submit() {
  if (loading.value) return;
  error.value = '';
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  loading.value = true;
  try {
    const result = mode.value === 'login'
      ? await api.login(username.value.trim(), password.value)
      : await api.register(username.value.trim(), password.value);
    setAuth(result.token, result.user);
    emit('logged-in', result.user);
  } catch (e) {
    error.value = e.message || '操作失败，请稍后再试';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <h2 class="login-title">{{ mode === 'login' ? '用户登录' : '注册新账号' }}</h2>
      <p class="login-sub">登录后你的存档将保存在自己的账号下，其他人不可见</p>

      <div class="login-form" @keyup.enter="submit">
        <label class="login-label">
          <span>用户名</span>
          <input v-model="username" type="text" maxlength="16" placeholder="2-16 位字母、数字、下划线或中文" autocomplete="username" />
        </label>
        <label class="login-label">
          <span>密码</span>
          <input v-model="password" type="password" maxlength="64" placeholder="6-64 位" autocomplete="current-password" />
        </label>

        <div v-if="error" class="login-error">{{ error }}</div>

        <button class="login-btn" :disabled="loading" @click="submit">
          {{ loading ? '请稍候…' : (mode === 'login' ? '登录' : '注册并登录') }}
        </button>

        <div class="login-switch">
          <template v-if="mode === 'login'">
            还没有账号？<a href="javascript:void(0)" @click="switchMode('register')">注册一个</a>
          </template>
          <template v-else>
            已有账号？<a href="javascript:void(0)" @click="switchMode('login')">直接登录</a>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: linear-gradient(160deg, #0d1117 0%, #161b22 100%);
}
.login-card {
  width: 100%;
  max-width: 380px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 28px 24px;
}
.login-title {
  margin: 0 0 6px;
  font-size: 20px;
  color: #e6edf3;
}
.login-sub {
  margin: 0 0 20px;
  font-size: 13px;
  color: #8b949e;
}
.login-label {
  display: block;
  margin-bottom: 14px;
}
.login-label span {
  display: block;
  font-size: 13px;
  color: #8b949e;
  margin-bottom: 6px;
}
.login-label input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #e6edf3;
  font-size: 14px;
}
.login-label input:focus {
  outline: none;
  border-color: #58a6ff;
}
.login-error {
  color: #f85149;
  font-size: 13px;
  margin-bottom: 12px;
}
.login-btn {
  width: 100%;
  padding: 10px 0;
  border: none;
  border-radius: 8px;
  background: #238636;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.login-btn:hover { background: #2ea043; }
.login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.login-switch {
  margin-top: 16px;
  font-size: 13px;
  color: #8b949e;
  text-align: center;
}
.login-switch a { color: #58a6ff; text-decoration: none; }
/* 手机端：输入框字号 ≥16px 防 iOS 聚焦自动放大页面；收紧卡片内边距 */
@media (max-width: 768px) {
  .login-wrap {
    padding: 12px;
    align-items: flex-start; /* 小屏键盘弹出时不被垂直居中裁切 */
    padding-top: 10vh;
  }
  .login-card {
    padding: 22px 18px;
    width: 100%;
    max-width: 360px;
  }
  .login-title {
    font-size: 18px;
  }
  .login-sub {
    font-size: 12px;
  }
  .login-label input {
    font-size: 16px;
    padding: 11px 12px;
  }
  .login-btn {
    font-size: 16px;
    padding: 12px;
  }
  .login-switch {
    font-size: 13px;
  }
}
</style>
