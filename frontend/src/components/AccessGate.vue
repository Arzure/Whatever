<script setup>
import { ref, onMounted, inject } from 'vue';
import { api, getAccessToken, setAccessToken } from '../api';

// 接入游戏状态：验证通过后需要重新加载存档并清除验证前残留的错误提示
const game = inject('game', null);

/**
 * 访问门禁：后端配置了 ACCESS_TOKEN 时，首次进入需要输入口令。
 * 挂载时探测：若 /api 返回 401，则显示口令层，验证通过后放行。
 */
const authed = ref(true); // 未配置口令时默认放行
const showInput = ref(false);
const input = ref('');
const errorMsg = ref('');
const verifying = ref(false);
// 探测中标记：验证完成前不渲染游戏内容，避免首页在口令验证前发起请求导致 401 错误残留
const probing = ref(true);

async function probe() {
  try {
    // 任意受保护接口做探测；401 会在此抛出
    await api.listModes();
    authed.value = true;
  } catch (e) {
    // 401 → 需要口令；其他错误（后端没起）也显示入口便于排查
    // 按 HTTP 状态码判断（401 = 需要口令），不依赖后端文案，文案改动不会破坏识别
    if (e.status === 401) {
      authed.value = false;
      showInput.value = true;
      // 口令验证前的 401 报错不应残留在游戏界面上
      if (game) game.state.error = '';
    } else {
      // 后端不可达：仍显示页面，错误条会自然提示
      authed.value = true;
    }
  }
  probing.value = false;
}

async function submit() {
  const token = input.value.trim();
  if (!token) {
    errorMsg.value = '请输入访问口令';
    return;
  }
  verifying.value = true;
  errorMsg.value = '';
  setAccessToken(token);
  try {
    await api.listModes(); // 用新口令重试，成功则放行
    authed.value = true;
    showInput.value = false;
    // 验证通过：清除任何残留错误，重新加载存档列表
    if (game) {
      game.state.error = '';
      game.refreshSaves();
    }
  } catch (e) {
    errorMsg.value = '口令不正确，请重试';
    setAccessToken(''); // 清空错误的 token
  } finally {
    verifying.value = false;
  }
}

onMounted(probe);
</script>

<template>
  <div v-if="showInput" class="access-gate">
    <div class="gate-card">
      <h2>🔐 访问口令</h2>
      <p class="gate-tip">请输入访问口令后继续。</p>
      <input
        v-model="input"
        type="password"
        class="gate-input"
        placeholder="输入访问口令"
        :disabled="verifying"
        @keyup.enter="submit"
      />
      <p v-if="errorMsg" class="gate-error">{{ errorMsg }}</p>
      <button class="gate-btn" :disabled="verifying" @click="submit">
        {{ verifying ? '验证中…' : '进入游戏' }}
      </button>
    </div>
  </div>
  <div v-else-if="probing" class="access-gate">
    <div class="gate-card">
      <h2>🔐 文字冒险</h2>
      <p class="gate-tip">正在验证访问权限…</p>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.access-gate {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--bg, #10131c);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.gate-card {
  width: 100%;
  max-width: 340px;
  background: var(--panel, #1a1f2e);
  border: 1px solid var(--border, #2c3245);
  border-radius: 12px;
  padding: 28px 24px;
  text-align: center;
}
.gate-card h2 {
  margin: 0 0 10px;
  font-size: 20px;
  color: var(--accent-2, #d4a12c);
}
.gate-tip {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--text-dim, #8a90a0);
}
.gate-input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--border, #2c3245);
  background: var(--bg, #10131c);
  color: var(--text, #e8e8e8);
  font-size: 15px;
  text-align: center;
  outline: none;
}
.gate-input:focus {
  border-color: var(--accent, #d4a12c);
}
.gate-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--danger, #e88);
}
.gate-btn {
  margin-top: 16px;
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: none;
  font-size: 15px;
  font-weight: 600;
  background: linear-gradient(135deg, var(--accent, #d4a12c), var(--accent-2, #ffd76a));
  color: #1a1303;
  cursor: pointer;
}
.gate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>