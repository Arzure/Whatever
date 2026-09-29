# 艾泽洛姆 · AI 文字冒险 RPG

> LLM 驱动的互动文字冒险游戏 —— 玩家的每个行动都会由 AI 实时生成剧情，世界随你的选择而变化。

- 技术栈：Node.js / Express / Vue 3 / Vite
- AI 接入：OpenAI 兼容接口（当前使用 Sensenova）
- 数据存储：JSON 文件（零数据库依赖）

---

## 1. 开发进度

### 已完成 ✅

| 模块 | 说明 |
|------|------|
| 后端 API | 新建游戏 / 读取存档 / 执行动作 / 删除存档 / 健康检查 |
| AI 剧情生成 | 调用 OpenAI 兼容接口，LLM 扮演游戏主持人（GM），实时生成剧情、选项与状态变化 |
| 角色状态系统 | 生命值（HP）、金币、经验升级（含升级回血）、背包增删、装备 |
| 存档系统 | JSON 文件持久化，支持多存档、列表展示、断点续玩 |
| 前端界面 | 暗色奇幻风 UI：开场页（新建/读档）、游戏页（对话流 + 状态面板 + 指令输入） |
| 选项持久化 | AI 推荐选项随剧情一起存入存档，重进游戏不丢失 |
| AI 输出可靠性 | 五层防护机制（参数调优 + 自动重试 + 降级兜底），实测 6/6 回合稳定（详见 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md)） |

### 已修复的 Bug 🐛

| 问题 | 根因 | 修复 |
|------|------|------|
| 返回主界面显示"尚无存档" | `listSaves()` 被误声明为 `async`，返回 Promise 被序列化成 `{}` | 移除 `async` 关键字（见 [server/storage.js](server/storage.js)） |
| 重进存档后 AI 推荐选项消失 | 历史记录只存 `content`，未存 `choices` | 选项随剧情一并持久化（见 [server/game.js](server/game.js)） |
| npm audit 报 2 个漏洞 | vite 5.x 内嵌 esbuild 存在 dev-server 漏洞 | 升级 vite 5.4.21 → 6.4.3，audit 归零 |
| AI 频繁返回无法解析的内容 | 模型不按协议输出 JSON（约 2/3 概率输出纯文本） | 五层防护：参数调优 + 自动重试 + 降级兜底（详见 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md)） |

### 已知限制 ⚠️

- AI 偶发仍可能输出纯文本，此时**自动降级接续剧情**（不再报错打断），该回合无推荐选项与数值变化
- 单人游戏（暂不支持多人在线）
- 数据为本地 JSON 文件，不适合多用户并发

---

## 2. 技术栈与架构

### 2.1 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 前端框架 | Vue 3（`<script setup>` 组合式 API） | 3.5.43 |
| 前端构建 | Vite | 6.4.3 |
| 后端框架 | Express | 4.19.2 |
| 运行时 | Node.js（内置 fetch 调 LLM，无需 SDK） | ≥ 18（实测 20.20.2） |
| AI 接口 | OpenAI 兼容 `/chat/completions` | 当前模型 `sensenova-6.8-flash-lite` |
| 数据存储 | JSON 文件（`data/` 目录） | — |

### 2.2 整体架构

```text
浏览器 (http://localhost:5173)
   │
   │  页面里的操作：新建 / 行动 / 读档 / 删除
   ▼
Vite 开发服务器 :5173
   │  代理转发 /api/* 请求（见 frontend/vite.config.js）
   ▼
Express 后端 :3001
   │
   ├── /api/saves           存档列表
   ├── /api/games           新建/读取/删除
   ├── /api/games/:id/action  核心游戏循环
   └── 游戏引擎 → LLM 网关 → 外部 AI 服务 (token.sensenova.cn)
               └── 存档读写 → data/*.json
```

### 2.3 核心工作流程

一次"玩家行动"的完整链路：

```text
1. 前端发送玩家输入 → POST /api/games/:id/action
2. 后端把玩家输入追加进对话历史
3. 构造系统提示词（世界观 + 角色面板 + 最近剧情回顾）
4. 调用 LLM → 返回 JSON：{ narrative, choices, delta, battle }
5. 严格解析 JSON（兼容 markdown 代码块包裹）
6. 应用 delta：生命/金币/经验/背包增减，处理升级与死亡
7. 剧情 + 选项写入历史并持久化到存档文件
8. 返回给前端渲染
```

### 2.4 AI 交互实现详解

本节说明游戏与 AI 交互的三个核心问题：**如何连接 AI、如何把世界观交给 AI、如何约束 AI 的输出**。

#### 2.4.1 连接 AI（server/llm.js）

- 项目**不依赖任何 AI SDK**，使用 Node.js ≥18 内置的 `fetch` 直接请求 OpenAI 兼容的 `/chat/completions` 接口
- 请求参数来自环境变量（`.env`）：`LLM_BASE_URL`（服务地址）、`LLM_API_KEY`（密钥）、`LLM_MODEL`（模型名）
- 由于遵循 OpenAI 兼容协议，**只需改 `.env` 即可切换任意兼容服务**（OpenAI 官方、Sensenova、DeepSeek、国内中转等）
- 认证方式：标准 `Authorization: Bearer <API Key>` 请求头
- 60 秒超时自动中断，防止模型响应卡死

**当前请求参数（针对 sensenova 系列调优）：**

| 参数 | 值 | 为什么 |
|------|-----|--------|
| `temperature` | 0.9 | 剧情随机性，创意写作偏高 |
| `max_tokens` | 2048 | 官方推荐普通任务额度；**思考模式下思考与输出共享此配额**，设太小会截断输出 |
| `reasoning_effort` | `"none"` | **关闭思考模式**（sensenova 思考默认开启，会抢占输出配额导致空内容） |
| `response_format` | `{type: "json_object"}` | 结构化输出，要求返回合法 JSON |

```js
// 核心调用（真实参数）
await fetch(`${cfg.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
  body: JSON.stringify({
    model, messages, temperature: 0.9, max_tokens: 2048,
    reasoning_effort: 'none',
    response_format: { type: 'json_object' },
  }),
});
```

#### 2.4.2 世界观与状态的传递（server/game.js → buildSystemPrompt）

每次调用 AI 前，后端会动态构造**系统提示词（system prompt）**，一次性告诉 AI 四类信息：

| 提示词组成部分 | 内容 | 作用 |
|---------------|------|------|
| **角色设定** | "你是「艾泽洛姆」的至高游戏主持人（Game Master）" | 定义 AI 的身份与职责 |
| **输出协议** | 必须输出指定结构的 JSON（见 2.4.3） | 让 AI 的返回可被程序解析 |
| **世界观** | "中世纪奇幻大陆「艾泽洛姆」…有龙、精灵、兽人、遗迹、瘟疫、财宝与阴谋" | 统一叙事背景，防止 AI 跑偏到现代/科幻 |
| **当前状态** | 玩家姓名/等级/HP/金币/装备/背包（`renderPlayer()` 生成） | 让 AI 知道玩家的实时数据，据此填 delta |
| **剧情回顾** | 最近 6 条对话历史（玩家行动 + 旁白） | 保证前后剧情连贯、承接上一回合 |

这套提示词在**每回合都重新生成**，因为玩家状态和历史在持续变化。它是"游戏规则"和"AI 行为"之间的桥梁。

#### 2.4.3 约束 AI 输出（多层防护架构）

AI 是"尽力遵守协议"的，不能指望它永远正确。本项目用**五层防护**确保游戏稳定：

**第 1 层 · 协议约束（提示词中强制）**

提示词明确要求 AI 只输出如下 JSON，不得输出其他文字：

```json
{
  "narrative": "本回合剧情，300~500字，第二人称，结尾不替玩家做决定",
  "choices": ["建议选项A", "建议选项B", "建议选项C"],
  "delta": { "hp": 0, "gold": 0, "exp": 0, "inventory": ["获得的物品"], "removeInventory": ["失去的物品"] },
  "battle": true
}
```

并附带数值规则：hp 幅度 5~40、gold 幅度 1~50、exp 幅度 10~30、未发生的事填 0 或空数组、死亡时 delta.hp 恰好归零等。

**第 2 层 · 参数约束（请求级）**

请求携带 `response_format: { type: "json_object" }` 从接口层要求 JSON 输出。**注意**：这是"软约束"——实测部分模型（如 sensenova-6.8-flash-lite）仅约 1/3 概率真正生效，因此还需要后续层兜底。

**第 3 层 · 容错解析（`parseActionJson`）**

- 兼容 AI 把 JSON 包在 markdown 代码块里的情况，自动提取 `{...}` 内容
- 兼容 `{` 前有换行/空白的情况
- 解析失败返回 `null`（**不再抛错打断游戏**），进入重试或降级流程

**第 4 层 · 自动重试（解析失败救回）**

首次解析失败时，用**精简提示词**重试一次：

```text
精简重试提示词 = JSON 格式模板 + 玩家状态 + 上一回合玩家行动
（不带冗长的 history，降低模型被历史纯文本"带偏"的概率）
```

实测：重试成功率 **100%**，绝大多数格式问题在重试后即恢复正常。

**第 5 层 · 降级兜底（永不卡死）**

重试仍失败（模型固执输出纯文本）时，直接把纯文本当作剧情接续，**不打断游戏**。前端用隐晦的游戏内语言过渡（如"命运之线悄然转动"），玩家感知不到技术细节，仅当轮次没有推荐选项和数值变化。

**状态兜底（贯穿第 3-5 层）**：`normalizeDelta` + `applyDelta` 做数值规范化与钳制——HP 钳制 `[0,100]`、金币不为负、背包上限 20、升级/死亡规则由后端强制执行。**即使 AI 返回异常数值，游戏状态也不会崩坏。**

> **五层防护的意义**：提示词"引导" → 参数"要求" → 解析"容错" → 重试"救回" → 降级"兜底"。每一层都为下一层的失效做准备，保证极端情况下游戏依然可玩。

### 2.4.4 关键知识点（踩坑总结）

1. **`response_format: json_object` 是软约束**：OpenAI 兼容接口的标准参数，但部分模型未真正实现。若需要硬约束，需换支持严格 JSON 模式的服务/模型。且使用时要确保提示词中包含 "json" 关键字与格式示例（官方要求）。
2. **sensenova 思考模式默认开启**：`reasoning_effort` 默认 `high`，思考内容与输出**共享 max_tokens 配额**。长剧情下配额被思考吃光 → `finish_reason: length` → 输出为空。解法：设 `reasoning_effort: "none"` 并提高 `max_tokens`。
3. **`thinking` 字段不等于 `reasoning_effort`**：部分文档提到的 `thinking: "disabled"` 在 sensenova 上**不受支持**（返回 HTTP 400）。关闭思考请用 `reasoning_effort: "none"`。
4. **测试必须模拟真实用户**：发"继续推进冒险N"这种无意义指令会让模型困惑，且降级产生的纯文本写回 history 会污染上下文、诱使模型模仿输出纯文本。应**读取 AI 返回的 choices 并选择其一继续**。
5. **降级文本要"隐晦"**：不要向玩家展示"AI 未按格式返回"等技术信息，用游戏内语言包装，保持沉浸感。

### 2.5 目录结构

```text
Whatever/
├── .env                  # 实际配置（含密钥，已 gitignore）
├── .env.example          # 配置模板（空值）
├── .gitignore
├── package.json          # 根：一键脚本
├── server/               # 后端
│   ├── index.js          # Express 入口 + 全部路由
│   ├── game.js           # 游戏引擎：提示词构造、JSON 解析、状态应用
│   ├── llm.js            # LLM 网关：fetch 调用 + 配置读取
│   ├── storage.js        # JSON 存档读写
│   └── config.js         # 极简 .env 加载器
├── frontend/             # 前端
│   ├── vite.config.js    # 代理 /api → :3001
│   └── src/
│       ├── App.vue       # 全部界面与交互逻辑
│       ├── main.js
│       └── style.css
├── data/                 # 游戏存档（运行时生成）
├── TECH_DOC.md           # 本技术文档（架构/AI 交互原理/踩坑总结）
├── DEVELOPMENT_LOG.md    # 开发记录（问题排查与修复过程）
└── game/                 # （空目录，早期规划遗留）
```

### 2.6 其他关键实现说明

- **前端交互**：输入框自由行动 + 推荐选项快捷点击；左侧实时显示 HP/金币/经验/背包；等待提示与战斗/死亡状态标识（`frontend/src/App.vue`）
- **选项持久化**：AI 推荐选项随剧情存入存档历史，重进游戏不丢失（`server/game.js`）
- **上下文裁剪**：对话历史超过 40 条时丢弃最早的记录，防止请求体无限膨胀、控制 token 消耗
- **自动重试**：AI 首次输出解析失败时，用精简提示词自动重试一次（见 2.4.3 第 4 层）

---

## 3. 如何启动

> 需要 **Node.js ≥ 18**，依赖已安装完毕（`node_modules` 已存在），无需重复 `npm install`。

### 3.1 两个终端分别启动（推荐）

```bash
# 终端 1 —— 后端（端口 3001）
cd server
npm start
# 看到 [艾泽洛姆] 服务已启动 + LLM 配置状态: 已配置

# 终端 2 —— 前端（端口 5173）
cd frontend
npm run dev
# 看到 VITE v6.4.3 ready + Local: http://localhost:5173/
```

浏览器打开 **http://localhost:5173** 开始游玩。

### 3.2 从项目根目录启动

```bash
npm run dev:server    # 终端 1（等价于 cd server && npm run dev）
npm run dev:frontend  # 终端 2（等价于 cd frontend && npm run dev）
```

### 3.3 首次部署 / 重新安装依赖

```bash
# 项目根目录执行，同时安装前后端依赖
npm run install:all
```

### 3.4 生产构建（可选）

```bash
npm run build:frontend   # 构建前端到 frontend/dist
npm start                # 后端同时托管 dist 静态文件
# 此时只需访问 http://localhost:3001 即可（无需另跑 Vite）
```

---

## 4. 如何关闭

| 场景 | 操作 |
|------|------|
| 正常关闭 | 在对应终端按 `Ctrl + C` |
| 只关后端 | 在跑后端的终端按 `Ctrl + C`（前端页面仍可打开，但操作会报错） |
| 只关前端 | 在跑前端的终端按 `Ctrl + C`（后端保持运行，数据不受影响） |
| 端口被占用 | `lsof -i :3001`（或 `:5173`）查看占用进程，`kill <PID>` |

---

## 5. 配置说明（.env）

项目根目录的 `.env` 控制所有运行配置：

```ini
LLM_BASE_URL=https://token.sensenova.cn/v1   # OpenAI 兼容服务地址
LLM_API_KEY=sk-xxxx                          # API Key（必填）
LLM_MODEL=sensenova-6.8-flash-lite           # 模型名
PORT=3001                                    # 后端端口
FRONTEND_ORIGIN=http://localhost:5173        # CORS 允许来源
```

注意事项：

- 修改 `.env` 后**必须重启后端**才生效（Node 不热加载）
- `.env` 含密钥，已被 `.gitignore` 排除；`.env.example` 是空模板，复制它生成 `.env`
- `PORT` 一般无需改动，前端通过 Vite 代理访问后端

---

## 6. 常见问题

**Q1：页面提示 "AI 处理失败：AI 返回了无法解析的内容"**
→ LLM 偶发未按约定输出 JSON。点击重试即可；若频繁出现，可增强提示词或加自动重试。

**Q2：页面提示 "未配置 LLM API"**
→ 检查根目录 `.env` 三个变量是否填写完整，改完重启后端。

**Q3：重进存档选项不显示**
→ 已修复（选项随历史持久化）。若为旧存档，新操作后的剧情会带选项。

**Q4：端口被占用**
→ 参考"如何关闭"一节清理残留进程。

---

## 7. 后续可扩展方向

- 多人在线（共享世界 / 实时协作冒险）
- 自动重试与更健壮的 JSON 解析（应对模型不稳定输出）
- 富文本渲染（物品/战斗高亮）、自动配图
- 数据库升级（SQLite）以支持多用户与查询
- 存档加密 / 云同步
