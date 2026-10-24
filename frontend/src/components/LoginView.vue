<script setup>
import { ref } from 'vue';
import { api, setAuth } from '../api';

const emit = defineEmits(['logged-in']);

const mode = ref('login'); // login | register
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const guestInfo = ref(null);
const guestLoading = ref(false);

async function guestLogin() {
  if (guestLoading.value) return;
  guestLoading.value = true;
  error.value = '';
  try {
    const result = await api.guest();
    guestInfo.value = { username: result.user.username, password: '123456' };
  } catch (e) {
    error.value = e.message || '操作失败，请稍后再试';
  } finally {
    guestLoading.value = false;
  }
}

async function guestEnter() {
  if (loading.value) return;
  loading.value = true;
  try {
    const result = await api.login(guestInfo.value.username, guestInfo.value.password);
    setAuth(result.token, result.user);
    emit('logged-in', result.user);
  } catch (e) {
    error.value = e.message || '登录失败';
  } finally {
    loading.value = false;
  }
}

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
        <button class="guest-btn" :disabled="guestLoading" @click="guestLogin">
          {{ guestLoading ? '请稍候…' : '游客快速进入' }}
        </button>
      </div>
    <!-- 游客账号弹窗 -->
    <div v-if="guestInfo" class="guest-modal">
      <div class="guest-modal-card">
        <h3>游客账号已创建</h3>
        <p>为您分配了以下账号，请妥善保管：</p>
        <div class="guest-info">
          <div><span>用户名</span><b>{{ guestInfo.username }}</b></div>
          <div><span>密码</span><b>{{ guestInfo.password }}</b></div>
        </div>
        <p class="guest-tip">可随时在设置中修改用户名或密码</p>
        <button class="guest-enter-btn" :disabled="loading" @click="guestEnter">
          {{ loading ? '请稍候…' : '快速登录并进入' }}
        </button>
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
  background: linear-gradient(160deg, var(--bg) 0%, var(--panel) 100%);
}
.login-card {
  width: 100%;
  max-width: 380px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px 24px;
}
.login-title {
  margin: 0 0 6px;
  font-size: 20px;
  color: var(--text);
}
.login-sub {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-dim);
}
.login-label {
  display: block;
  margin-bottom: 14px;
}
.login-label span {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.login-label input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
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
  /* 与口令输入页按钮同款：主题强调色渐变（深色金色/浅色紫色），深色主题下深字 */
  background: linear-gradient(135deg, var(--accent, #d4a12c), var(--accent-2, #ffd76a));
  color: #1a1303;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.15s ease;
}
.login-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
.login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
/* 浅色主题：紫色渐变底配白字（与口令页按钮一致） */
html.light .login-btn {
  color: #ffffff;
}
.login-switch {
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-dim);
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
/* guest login */
.guest-btn {
  width: 100%;
  padding: 10px 0;
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.guest-btn:hover { border-color: #58a6ff; color: #58a6ff; }
.guest-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.guest-modal {
  position: fixed;
  inset: 0;
  display: flex;
  z-index: 9999;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
}
.guest-modal-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 28px 24px;
  max-width: 360px;
  width: 90%;
  text-align: center;
}
.guest-modal-card h3 { margin: 0 0 12px; color: var(--text); font-size: 18px; }
.guest-modal-card p { color: var(--text-dim); font-size: 13px; margin: 6px 0; }
.guest-info {
  margin: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.guest-info > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--panel-2);
}
.guest-info span { color: var(--text-dim); font-size: 13px; }
.guest-info b { color: var(--accent); font-size: 15px; }
.guest-tip { font-size: 12px !important; opacity: 0.7; }
.guest-enter-btn {
  width: 100%;
  padding: 10px 0;
  margin-top: 16px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #1a1303;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
html.light .guest-enter-btn { color: #fff; }
</style>
