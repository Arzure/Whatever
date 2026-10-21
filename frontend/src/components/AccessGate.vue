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

async function probe(retries = 2) {
  try {
    // 任意受保护接口做探测；401 会在此抛出
    await api.listModes();
    authed.value = true;
  } catch (e) {
    // 401 → 需要口令；按 HTTP 状态码判断，不依赖后端文案
    if (e.status === 401) {
      authed.value = false;
      showInput.value = true;
      // 口令验证前的 401 报错不应残留在游戏界面上
      if (game) game.state.error = '';
    } else if (retries > 0) {
      // 网络瞬断/请求被中断（快速刷新常见）：重试探测，不放行——
      // 放行会导致未验口令就显示登录界面（后端仍会拦截，但不符合门禁预期）
      await new Promise((r) => setTimeout(r, 300));
      return probe(retries - 1);
    } else {
      // 重试仍失败：显示口令输入层（保守处理——宁可多输一次口令，不可绕过门禁）
      authed.value = false;
      showInput.value = true;
      if (game) game.state.error = '';
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
        {{ verifying ? '验证中…' : '进入工坊' }}
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
/* 手机端口令门禁：输入框 16px 防 iOS 聚焦缩放，键盘弹出时顶部对齐不被裁切 */
@media (max-width: 768px) {
  .access-gate {
    align-items: flex-start;
    padding-top: 18vh;
  }
  .gate-card {
    max-width: 320px;
    padding: 22px 18px;
  }
  .gate-card h2 {
    font-size: 18px;
  }
  .gate-input {
    font-size: 16px;
    padding: 11px 12px;
  }
  .gate-btn {
    font-size: 16px;
    padding: 11px;
  }
}
</style>