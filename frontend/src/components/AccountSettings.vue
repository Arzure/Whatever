<script setup>
import { ref } from 'vue';
import { api, setAuth } from '../api';

const props = defineProps({ user: { type: Object, required: true } });
const emit = defineEmits(['close', 'renamed', 'deleted', 'logout']);

const tab = ref('rename'); // rename | password | delete
const error = ref('');
const notice = ref('');
const loading = ref(false);

// 修改用户名
const newName = ref(props.user.username);
const renamePassword = ref('');

// 修改密码
const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');

// 删除账号
const deletePassword = ref('');
const deleteConfirmText = ref('');

function switchTab(t) {
  tab.value = t;
  error.value = '';
  notice.value = '';
}

async function doRename() {
  if (loading.value) return;
  error.value = '';
  notice.value = '';
  if (!newName.value.trim() || !renamePassword.value) {
    error.value = '请输入新用户名和当前密码';
    return;
  }
  loading.value = true;
  try {
    const r = await api.rename(renamePassword.value, newName.value.trim());
    setAuth(r.token, r.user);
    notice.value = '用户名修改成功';
    emit('renamed', r.user);
    renamePassword.value = '';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function doChangePassword() {
  if (loading.value) return;
  error.value = '';
  notice.value = '';
  if (!oldPassword.value || !newPassword.value) {
    error.value = '请输入旧密码和新密码';
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  loading.value = true;
  try {
    await api.changePassword(oldPassword.value, newPassword.value);
    notice.value = '密码修改成功，下次登录请使用新密码';
    oldPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function doDelete() {
  if (loading.value) return;
  error.value = '';
  notice.value = '';
  if (!deletePassword.value) {
    error.value = '请输入密码确认删除';
    return;
  }
  if (deleteConfirmText.value !== '删除') {
    error.value = '请输入「删除」二字以确认';
    return;
  }
  loading.value = true;
  try {
    await api.deleteAccount(deletePassword.value);
    setAuth('', null);
    emit('deleted');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <h3>账号设置</h3>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="tabs">
        <button :class="{ active: tab === 'rename' }" @click="switchTab('rename')">修改用户名</button>
        <button :class="{ active: tab === 'password' }" @click="switchTab('password')">修改密码</button>
        <button :class="{ active: tab === 'delete' }" @click="switchTab('delete')">删除账号</button>
        <button class="tab-logout" @click="emit('logout')">退出登录</button>
      </div>

      <div v-if="error" class="form-error">{{ error }}</div>
      <div v-if="notice" class="form-notice">{{ notice }}</div>

      <!-- 修改用户名 -->
      <div v-if="tab === 'rename'" class="form" @keyup.enter="doRename">
        <label>
          <span>当前用户名：{{ user.username }}</span>
        </label>
        <label>
          <span>新用户名</span>
          <input v-model="newName" type="text" maxlength="16" placeholder="2-16 位字母、数字、下划线或中文" />
        </label>
        <label>
          <span>当前密码</span>
          <input v-model="renamePassword" type="password" maxlength="64" placeholder="验证身份" />
        </label>
        <button class="btn primary" :disabled="loading" @click="doRename">{{ loading ? '提交中…' : '确认修改' }}</button>
      </div>

      <!-- 修改密码 -->
      <div v-if="tab === 'password'" class="form" @keyup.enter="doChangePassword">
        <label>
          <span>旧密码</span>
          <input v-model="oldPassword" type="password" maxlength="64" />
        </label>
        <label>
          <span>新密码</span>
          <input v-model="newPassword" type="password" maxlength="64" placeholder="6-64 位" />
        </label>
        <label>
          <span>确认新密码</span>
          <input v-model="confirmPassword" type="password" maxlength="64" />
        </label>
        <button class="btn primary" :disabled="loading" @click="doChangePassword">{{ loading ? '提交中…' : '确认修改' }}</button>
      </div>

      <!-- 删除账号 -->
      <div v-if="tab === 'delete'" class="form">
        <p class="warn-text">删除账号将同时删除你的全部存档，此操作不可恢复！</p>
        <label>
          <span>当前密码</span>
          <input v-model="deletePassword" type="password" maxlength="64" placeholder="验证身份" />
        </label>
        <label>
          <span>输入「删除」二字确认</span>
          <input v-model="deleteConfirmText" type="text" placeholder="删除" />
        </label>
        <button class="btn danger" :disabled="loading" @click="doDelete">{{ loading ? '提交中…' : '永久删除账号' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}
.modal {
  width: 100%;
  max-width: 400px;
  background: #131a2e;
  border: 1px solid #2e3b63;
  border-radius: 12px;
  padding: 20px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.modal-head h3 {
  margin: 0;
  color: #e6edf3;
  font-size: 17px;
}
.close-btn {
  background: none;
  border: none;
  color: #8b949e;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}
.close-btn:hover { color: #e6edf3; }
/* 标签栏：自适应布局（通用方案）——空间够单行铺满，不够自动整齐换行，不依赖断点 */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}
.tabs button {
  flex: 1 1 auto; /* 按内容自然宽度伸展，不再强制等分挤压 */
  min-width: 4em;
  white-space: nowrap;
  padding: 8px 0;
  border: 1px solid #2e3b63;
  border-radius: 6px;
  background: #0a0e1a;
  color: #8b949e;
  font-size: 13px;
  cursor: pointer;
}
.tabs button.active {
  border-color: #58a6ff;
  color: #58a6ff;
}
/* 退出登录：标签栏末尾的独立动作按钮（非标签，点击即退出） */
.tabs .tab-logout {
  color: #ff7d7d;
}
.tabs .tab-logout:hover {
  color: #ff9d9d;
  border-color: #ff7d7d;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.form label span {
  font-size: 13px;
  color: #8b949e;
}
.form input {
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid #2e3b63;
  background: #0a0e1a;
  color: #e6edf3;
  font-size: 14px;
}
.form input:focus {
  outline: none;
  border-color: #58a6ff;
}
.form-error {
  color: #f85149;
  font-size: 13px;
  margin-bottom: 12px;
}
.form-notice {
  color: #3fb950;
  font-size: 13px;
  margin-bottom: 12px;
}
.warn-text {
  color: #f85149;
  font-size: 13px;
  margin: 0;
  line-height: 1.6;
}
.btn {
  padding: 10px 0;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  margin-top: 4px;
}
.btn.primary {
  background: #238636;
  color: #fff;
}
.btn.primary:hover { background: #2ea043; }
.btn.danger {
  background: #8b1d1d;
  color: #fff;
}
.btn.danger:hover { background: #a52a2a; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
/* 手机端：标签栏允许换行（四个按钮挤不下一行）、弹窗收紧、输入框字号 ≥16px 防 iOS 聚焦缩放 */
@media (max-width: 768px) {
  .modal-mask {
    padding: 10px;
    align-items: flex-start; /* 小屏键盘弹出时不被垂直居中裁切 */
  }
  .modal {
    padding: 16px 14px;
    max-height: 88vh; /* 长内容（删除账号含警告文本）可滚动，不溢出屏幕 */
    overflow-y: auto;
  }
  .modal-head h3 {
    font-size: 16px;
  }
  .tabs button {
    font-size: 12px;
    padding: 8px 0;
  }
  .form input {
    font-size: 16px;
  }
  .form label {
    margin-bottom: 10px;
  }
  .form .btn {
    font-size: 15px;
    padding: 11px;
  }
  .warn-text {
    font-size: 13px;
  }
}
</style>
