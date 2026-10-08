/** 后端 API 薄封装：统一处理 JSON、错误信息与请求头。 */

async function request(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export const api = {
  health: () => request('/health'),
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
  itemOp: (id, op, body) => request(`/games/${id}/${op}`, { method: 'POST', body: JSON.stringify(body) }),
};
