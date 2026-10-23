/** 后端 API 薄封装：统一处理 JSON、错误信息与请求头。 */

const TOKEN_KEY = 'rpg_access_token';
const AUTH_KEY = 'rpg_auth_token';
const AUTH_USER_KEY = 'rpg_auth_user';
// 口令有效期：7 天（毫秒）。过期后自动清除，需重新输入
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 读取本地保存的访问口令（无则空串）。
 * 存储结构：{ token, savedAt }。超过 24 小时自动清除并返回空串。
 * 旧格式（纯字符串，无时间戳）视为已过期，同样清除，确保升级后重新验证。
 */
export function getAccessToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return '';
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      record = null;
    }
    // 结构不合法或已过期：清除并要求重新输入
    if (!record || typeof record.token !== 'string' || Date.now() - record.savedAt > TOKEN_TTL_MS) {
      localStorage.removeItem(TOKEN_KEY);
      return '';
    }
    return record.token;
  } catch {
    return '';
  }
}

/** 保存访问口令到本地（带时间戳，24 小时内免输入） */
export function setAccessToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, savedAt: Date.now() }));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** 读取登录令牌（无则空串） */
export function getAuthToken() {
  try { return localStorage.getItem(AUTH_KEY) || ''; } catch { return ''; }
}

/** 保存/清除登录令牌与用户信息 */
export function setAuth(token, user) {
  try {
    if (token) {
      localStorage.setItem(AUTH_KEY, token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || null));
    } else {
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** 读取本地缓存的用户信息（无则 null） */
export function getAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function request(path, opts = {}) {
  // FormData（文件上传）不设 Content-Type，由浏览器自动生成 multipart 边界
  const headers = opts.body instanceof FormData ? { ...(opts.headers || {}) } : { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getAccessToken();
  if (token) headers['X-Access-Token'] = token;
  const authToken = getAuthToken();
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`/api${path}`, {
    headers,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 抛错时附带 HTTP 状态码，供调用方（如口令门禁）按状态码判断，而非依赖文案关键词
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  // —— 3D 游戏资源票据：登录用户领取短期 cookie（Path=/3d/），游戏文件仅对持票者开放 ——
  ticket3d: () => request('/3d/ticket', { method: 'POST' }),
  // —— 账号体系 ——
  register: (username, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
  // —— 账号管理 ——
  rename: (password, username) =>
    request('/auth/rename', { method: 'POST', body: JSON.stringify({ password, username }) }),
  changePassword: (oldPassword, newPassword) =>
    request('/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),
  deleteAccount: (password) =>
    request('/auth/delete', { method: 'POST', body: JSON.stringify({ password }) }),
  // —— 存档删除 ——
  deleteSave: (id) => request(`/games/${id}`, { method: 'DELETE' }),
  deleteAllSaves: () => request('/games', { method: 'DELETE' }),
  // 终局插画（推理杀，未配置 IMAGE_MODEL 时返回 disabled）
  endingArt: (gameId) => request(`/games/${gameId}/ending-art`, { method: 'POST' }),
  portrait: (gameId, name) => request(`/games/${gameId}/portrait`, { method: 'POST', body: JSON.stringify({ name }) }),
  drawOptions: () => request('/draw/options'),
  drawGenerate: (params) => request('/draw/generate', { method: 'POST', body: JSON.stringify(params) }),
  drawEdit: (params) => request('/draw/edit', { method: 'POST', body: JSON.stringify(params) }),
  drawHistory: () => request('/draw/history'),
  drawHistoryDelete: (id) => request(`/draw/history/${id}`, { method: 'DELETE' }),
  officeConfig: () => request('/office/config'),
  officeInfographic: (params) => request('/office/infographic', { method: 'POST', body: JSON.stringify(params) }),
  officeResume: (params) => request('/office/resume', { method: 'POST', body: JSON.stringify(params) }),
  officeChart: (params) => request('/office/chart', { method: 'POST', body: JSON.stringify(params) }),
  officeExcel: (params) => request('/office/excel', { method: 'POST', body: JSON.stringify(params) }),
  officeReport: (params) => request('/office/report', { method: 'POST', body: JSON.stringify(params) }),
  // 报告任务状态查询（异步生成，前端轮询获取进度与结果）
  officeReportStatus: (taskId) => request(`/office/report-status/${encodeURIComponent(taskId)}`),
  officeTaskStatus: (taskId) => request(`/office/task-status/${encodeURIComponent(taskId)}`),
  officeImitate: (params) => request('/office/imitate', { method: 'POST', body: JSON.stringify(params) }),
  drawExtractPrompt: (params) => request('/draw/extract-prompt', { method: 'POST', body: JSON.stringify(params) }),
  // —— AI 对话（会话与消息持久化）——
  chatSessions: () => request('/chat/sessions'),
  chatNewSession: () => request('/chat/sessions', { method: 'POST', body: JSON.stringify({}) }),
  chatSession: (id) => request(`/chat/sessions/${encodeURIComponent(id)}`),
  chatSend: (id, content) => request(`/chat/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  chatRename: (id, title) => request(`/chat/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  chatDelete: (id) => request(`/chat/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chatClearAll: () => request('/chat/sessions', { method: 'DELETE' }),
  officePpt: (params) => request('/office/ppt', { method: 'POST', body: JSON.stringify(params) }),
  // 文档解析：上传 Word/PDF 提取文本（multipart 文件上传）
  officeDocParse: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('/office/doc-parse', { method: 'POST', body: fd });
  },
  officeReportWrite: (params) => request('/office/report-write', { method: 'POST', body: JSON.stringify(params) }),
  // 办公历史（报告网页化/演示文稿/报告写作，24 小时暂存）
  officeHistory: () => request('/office/history'),
  adminUsers: () => request('/admin/users'),
  adminUserSessions: (id) => request(`/admin/users/${id}/sessions`),
  adminDeleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminResetPassword: (id, password) => request(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
  drawPrompts: (source) => request(`/draw/prompts${source ? `?source=${source}` : ''}`),
  drawPromptDelete: (id) => request(`/draw/prompts/${id}`, { method: 'DELETE' }),
  listModes: () => request('/modes'),
  listThemes: () => request('/themes'),
  listGenres: () => request('/genres'),
  parseTheme: (text) => request('/themes/parse', { method: 'POST', body: JSON.stringify({ text }) }),
  listSaves: () => request('/saves'),
  createGame: (payload) => request('/games', { method: 'POST', body: JSON.stringify(payload) }),
  loadGame: (id) => request(`/games/${id}`),
  // 案件说明（含谜底）；仅在玩家主动展开时请求
  getCase: (id) => request(`/games/${id}/case`),
  // scene 为可选的场景切换按钮通道（探案模式使用）
  action: (id, action, scene) =>
    request(`/games/${id}/action`, { method: 'POST', body: JSON.stringify({ action, scene }) }),
  accuse: (id, suspectId) =>
    request(`/games/${id}/accuse`, { method: 'POST', body: JSON.stringify({ suspectId }) }),
  confront: (id, clues) =>
    request(`/games/${id}/confront`, { method: 'POST', body: JSON.stringify({ clues }) }),
  // 狼人杀投票放逐
  vote: (id, targetId) =>
    request(`/games/${id}/vote`, { method: 'POST', body: JSON.stringify({ targetId }) }),
  // 推理杀法官裁决（targetId 为空=放弃处刑）
  adjudicate: (id, targetId) =>
    request(`/games/${id}/adjudicate`, {
      method: 'POST',
      body: JSON.stringify(Array.isArray(targetId) ? { targetIds: targetId } : { targetId }),
    }),
  itemOp: (id, op, body) => request(`/games/${id}/${op}`, { method: 'POST', body: JSON.stringify(body) }),
  // —— 推理杀推测身份标记（云端同步） ——
  getMarks: (id) => request(`/games/${id}/marks`),
  saveMarks: (id, marks) =>
    request(`/games/${id}/marks`, { method: 'POST', body: JSON.stringify({ marks }) }),
};
