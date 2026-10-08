# AI 文字冒险 RPG · 技术文档

> LLM 驱动的多模式互动文字冒险游戏 —— 玩家的每个行动都会由 AI 实时生成剧情，世界随你的选择而变化。

- 技术栈：Node.js / Express / Vue 3 / Vite
- AI 接入：OpenAI 兼容接口（当前使用 Sensenova）
- 数据存储：JSON 文件（零数据库依赖）
- 核心设计：**可插拔游戏模式（Mode） + 世界观配置（Theme）**

---

## 1. 开发进度

### 已完成 ✅

| 模块 | 说明 |
|------|------|
| 多模式架构 | 模式注册表 + 可插拔模式处理器；`/api/modes` 供前端选择，新增模式无需改动路由 |
| 大世界模式 | 原有自由探索玩法迁移至 `server/modes/world.js`，由世界观配置驱动 |
| 世界观系统 | 内置模板（`themes/azeroth.json`）+ **纯文本世界观由 AI 结构化为可玩配置** |
| 能力驱动（capabilities） | 是否战斗、启用哪些数值、有哪些装备槽、物品类别，全部由世界观决定，前端与提示词动态适配 |
| 引擎共享层 | JSON 容错解析 / 自动重试 / 降级兜底 / 物品按钮操作，模式无关（`server/engine.js`） |
| 角色状态系统 | 生命值（HP）、金币、经验升级（含升级回血）、背包增删、装备槽 |
| 存档系统 | JSON 文件持久化，支持多存档、列表展示（含模式与世界名）、断点续玩 |
| 前端界面 | 首页（模式/世界选择 + 文本导入 + 存档列表）、游戏页（对话流 + 能力驱动的动态侧栏） |
| 选项持久化 | AI 推荐选项随剧情一起存入存档，重进游戏不丢失 |
| AI 输出可靠性 | 五层防护机制（参数调优 + 自动重试 + 降级兜底），详见 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) |
| 案件引擎 | 探案模式案件生成：真相 schema（凶手/动机/手法/物证/说谎者/关键线索）+ 提示词 + 结构校验（[server/casegen.js](server/casegen.js)）；**死者绝不被混入嫌疑人**（normalizeCase 确定性剔除 + validateCase 拦截） |
| 探案模式 | `server/modes/detective.js`：场景切换/物证发现/物证击破（含凶手）由代码确定性结算，AI 只演绎；无效行动拦截 `quickNoopReply`；告破复盘 `caseResult`；两类数值规则（指认-25、举证0.6覆盖率） |
| 探案前端 | 题材选择（现代都市/古代衙门/民国旧案/奇幻王国/**蒸汽时代**）+ DetectiveView（案件说明折叠/含谜底二次确认、场景与人物按钮、物证槽含描述、线索列表、指认与举证面板、win 证据复盘） |

### 已修复的 Bug 🐛

| 问题 | 根因 | 修复 |
|------|------|------|
| 返回主界面显示"尚无存档" | `listSaves()` 被误声明为 `async`，返回 Promise 被序列化成 `{}` | 移除 `async` 关键字（[server/storage.js](server/storage.js)） |
| 重进存档后 AI 推荐选项消失 | 历史记录只存 `content`，未存 `choices` | 选项随剧情一并持久化（现位于 [server/modes/world.js](server/modes/world.js)） |
| npm audit 报 2 个漏洞 | vite 5.x 内嵌 esbuild 存在 dev-server 漏洞 | 升级 vite 5.4.21 → 6.4.3，audit 归零 |
| AI 频繁返回无法解析的内容 | 模型不按协议输出 JSON（约 2/3 概率输出纯文本） | 五层防护：参数调优 + 自动重试 + 降级兜底（详见 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md)） |
| 使用道具一次扣光 / 卸下装备消失 | 按钮动作未同步给 AI，AI 又重复移动物品 | **架构级硬约束**：AI 无权移动物品，所有物品操作只能由前端按钮触发 |
| 终局出现"永远拿不到的关键证据" | 案件生成把死者混入 suspects 且配了口供，keyClues 未排除死者名下线索 | `normalizeCase` 确定性剔除死者嫌疑人 + `validateCase` 拦截（详见 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md)） |
| 探案叙事"人人疑神疑鬼"、无效探索冗长 | 提示词未约束诚实 NPC 风格；narrative 固定 300~500 字；无"已问尽/已搜遍"终止信号 | 诚实 NPC 坦然基调（规则 4.2）+ 字数弹性 + `quickNoopReply()` 无效行动拦截 |

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
   │  页面里的操作：新建 / 行动 / 读档 / 删除 / 物品按钮
   ▼
Vite 开发服务器 :5173
   │  代理转发 /api/* 请求（见 frontend/vite.config.js）
   ▼
Express 后端 :3001  (server/index.js)
   │
   ├── /api/health              健康检查（含 LLM 配置状态）
   ├── /api/modes               可用游戏模式列表
   ├── /api/themes              内置世界观列表
   ├── /api/themes/parse        纯文本世界观 → AI 结构化配置
   ├── /api/genres              探案题材列表（现代都市/古代衙门/民国旧案/奇幻王国）
   ├── /api/saves               存档列表
   ├── /api/games               新建 / 读取 / 删除
   ├── /api/games/:id/save      手动保存
   ├── /api/games/:id/case      探案：案件说明（含谜底，玩家主动展开时才下发）
   ├── /api/games/:id/accuse    探案：指认凶手（对则进对质、错则扣血）
   ├── /api/games/:id/confront  探案：举证令凶手认罪（0.6 覆盖率判定）
   ├── /api/games/:id/action    核心游戏循环（按 mode 分发）
   └── /api/games/:id/{use-item,equip,unequip,discard,cancel-pending}
                                物品按钮操作（按 mode 分发）
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │  modes/ 模式处理器（可插拔）    │
                  │   ├── world.js 大世界模式      │
                  │   └── detective.js 探案模式    │
                  └──────────────┬───────────────┘
                                 │ 复用
                  ┌──────────────▼───────────────┐
                  │  engine.js 引擎共享层         │
                  │   解析 / 重试 / 降级 / 物品操作 │
                  └──────────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
         llm.js 网关        themes/ 世界观       storage.js 存档
      (外部 AI 服务)     (模板 + 文本结构化)     (data/*.json)
```

### 2.3 核心工作流程

一次"玩家行动"的完整链路：

```text
1. 前端发送玩家输入 → POST /api/games/:id/action
2. 后端 findGame() 载入存档，按其 mode 找到对应模式处理器
3. 模式处理器把玩家输入追加进对话历史（并合并待结算的按钮动作）
4. 按「世界观配置」构造系统提示词（能力裁剪 + 角色面板 + 最近剧情回顾）
5. 调用 LLM → 返回 JSON：{ narrative, choices, delta, battle? }
6. 严格解析 JSON（兼容 markdown 代码块包裹）
7. 按世界观启用的字段应用 delta：生命/金币/经验/背包，处理升级与死亡
8. 剧情 + 选项写入历史并持久化到存档文件
9. 返回给前端渲染
```

### 2.4 多模式 + 世界观架构

这是本项目与"单一题材文字冒险"最大的区别，是后续扩展（如探案模式）的地基。

#### 2.4.1 游戏模式（Mode）——可插拔

`server/modes/index.js` 是一张模式注册表：

```js
const MODES = { [world.modeId]: world };   // 新增模式只需在此登记
function getMode(id) { return MODES[id] || null; }
function listModes() { /* 返回 [{id, name, needsTheme}] 供前端渲染 */ }
```

每个模式模块需导出统一契约，路由**只认契约、不认具体模式**：

| 导出 | 作用 |
|------|------|
| `modeId` / `modeName` | 模式标识与展示名 |
| `needsTheme` | 是否需要世界观配置（大世界模式为 `true`） |
| `newGame(name, { theme })` | 初始化一局游戏 |
| `processAction(game, input)` | 核心回合处理（提示词 + LLM + 状态应用） |
| `useItem / discardItem / equipItem / unequipItem / cancelPendingAction` | 物品按钮操作 |
| `summarize(game)` | 存档摘要 |

> 已有实例：**探案模式（`detective`）** 正是在不修改 `index.js` 路由的前提下通过注册表接入的——它注册了 `needsGenre`（题材）与探案专用接口 `accuse` / `confront`、`GET /case`，路由层仅新增了这几个探案专属 URI，核心 `/action` 循环仍走统一契约分发。前端首页从 `/api/modes` 动态渲染出「探案模式」卡片与题材选择。

#### 2.4.2 世界观配置（Theme）——数据驱动

一个 Theme 描述了"这个世界长什么样、玩家能做什么"：

```jsonc
{
  "id": "azeroth",
  "name": "艾泽洛姆",
  "intro": "中世纪奇幻大陆……",
  "capabilities": {
    "hasCombat": true,                       // 是否有战斗
    "statSchema": ["hp", "gold", "exp"],     // 启用哪些数值
    "itemCategories": ["weapon", "armor", "item"], // 有哪些物品类别
    "slots": [                               // 有哪些装备槽
      { "id": "weapon", "label": "武器" },
      { "id": "armor", "label": "防具" }
    ]
  },
  "startState": { "hp": 100, "gold": 10, "inventory": ["干粮 x2"], "slots": { "weapon": "武器·旧铁剑[普通]" } },
  "gmGuidelines": "该世界特有的叙事约束"
}
```

**capabilities 是"通用化"的关键**：它同时驱动后端提示词与前端 UI，从而支持任意题材：

| 世界观举例 | hasCombat | statSchema | itemCategories | slots |
|-----------|-----------|------------|----------------|-------|
| 中世纪奇幻（艾泽洛姆） | true | hp, gold, exp | weapon, armor, item | 武器、防具 |
| 现代悬疑 / 解谜 | false | hp | item | （无） |

`server/themes/index.js` 的 `normalizeTheme()` 会做安全兜底：至少保留 `hp`、至少保留 `item` 类别；若没有 `weapon`/`armor` 类别，则**自动移除对应装备槽**，并让 `startState.slots` 的键与 `slots` 完全对齐 —— 保证引擎取用安全。

#### 2.4.3 纯文本世界观 → 可玩配置

玩家在首页粘贴一段世界观文本，后端 `themes.parseThemeFromText()`：

1. 用一段**元提示词**要求 AI 只输出符合 Theme 结构的 JSON（明确"无需战斗时必须 `slots: []`、`itemCategories` 只含 `item`"等规则）
2. 复用 `parseActionJson()` 容错解析
3. 经 `normalizeTheme()` 规范化后返回前端
4. 前端把该对象随"新建游戏"请求带回，落库到存档的 `theme` 字段

> 该接口**不落盘**：自定义世界观随具体存档保存，不污染内置模板目录。

#### 2.4.4 能力驱动的 UI（前端）

`frontend/src/composables/useGame.js` 通过 `provide('game', ...)` 暴露模式无关的状态与操作；`WorldView.vue` 按 `state.theme.capabilities` 动态渲染：

```js
const caps  = computed(() => state.theme?.capabilities || { ...默认值 });
const stats = computed(() => caps.value.statSchema);   // 决定显示 HP / 金币 / 经验条
const slots = computed(() => caps.value.slots);         // 决定渲染哪些装备槽
const hasItem = computed(() => caps.value.itemCategories.includes('item'));
```

因此同一套前端可渲染"有武器防具的奇幻世界"与"只有背包的现代世界"，无需分支硬编码。

#### 2.4.5 探案模式设计（案件驱动的确定性结算）

探案模式与"大世界模式"最大的区别：**真相由代码持有，AI 只负责演绎**，防止真相漂移。

**案件真相（`game.case`）** —— 生成时由 AI 产出、经结构校验后落库：

| 字段 | 说明 |
|------|------|
| `culpritId` / `victim` | 凶手 / 死者（含死因与发现信息） |
| `crime` | 动机 / 手法 / 时间窗 / 破绽 |
| `suspects[]` | 嫌疑人：`isLiar`（说谎者）、`statements[]`（口供，`truth` 标记真假）、`rebuttalEvidenceId`（能击破他的物证）、`onRebuttal`（被击破后交代的真相与撒谎原因） |
| `evidence[]` | 物证：`foundAt`（发现场景）、`rebuts[]`（能反驳哪些嫌疑人，含说谎者与凶手） |
| `scenes[]` | 场景：`npcs`（在场人物），探索范围明确、无法无穷自由探索 |
| `keyClues[]` | 关键线索 id（2~4 条，**不得来自凶手、也不得来自死者**），举证时按覆盖率判定认罪 |

**题材（`GET /api/genres`）**：现代都市 / 古代衙门 / 民国旧案 / 奇幻王国 / **蒸汽时代**（维多利亚式欧洲推理，`server/casegen.js` 的 `GENRES` 注册即可，前端自动渲染）。

**案件生成的结构硬约束**：
- **死者绝不能出现在 `suspects` 中**（`normalizeCase` 按「与 `victim.name` 同名 / identity 含 受害·死者·被害人」确定性剔除；`validateCase` 也会拦截）。死者的言论只能由活着的证人转述（如「（管家口述）凌女士那晚曾说…」），keyClues 必须来自可盘问的活人——否则会出现"玩家永远拿不到的关键证据"。

**确定性结算（代码判定，AI 只演绎）**：

| 事件 | 判定 |
|------|------|
| 场景切换 | 玩家提交含场景名的行动（或点场景按钮）→ 代码移动 `detective.currentScene` |
| 发现物证 | 行动命中物件物证所在场景的关键词 → 代码将「物证·xxx」放入背包 |
| 击破谎言 | 玩家**装备**物证并当面质问在场嫌疑人，且物证 `rebuts` 命中该人（**不限于说谎者，凶手也可被击破**）→ 代码判定击破。说谎者全盘交代真相+撒谎原因；凶手被击破后只会**部分坦言**（如承认到过现场，但绝不直接自证杀人，认罪仍须走举证） |
| 指认凶手 | `detective.accuse(id)`：命中 `culpritId` → 进入对质；否则 `hp -25`，归零则游戏失败 |
| 举证认罪 | `detective.confront(clueIds)`：提交的线索中命中 `keyClues` 的覆盖率 ≥ `CONFESS_RATIO(0.6)` → 凶手认罪、胜利；失败不扣血、线索不消耗 |
| 无效行动拦截 | `quickNoopReply()`：盘问**已问尽的诚实 NPC**（口供全取得且非说谎者/凶手）或**重复搜索已搜遍的场景**（无未发现物证）→ 程序直接返回一句简短反馈与引导选项，**不调 LLM**，杜绝"人人疑神疑鬼 + 无效推进冗长" |

**游戏状态（`game.detective`）**：`phase`（`investigate → confront → win/lose`）、`clues[]`（已获得的线索及真伪标记）、`evidenceIds`、`revealed[]`（已被击破的人）、`failedAccusations`、`currentScene`。

**快照防剧透（`snapshot()`）**：下发给前端的探案状态**剔除一切真相字段**（`isCulprit/isLiar/truth/culpritId/keyClues/crime`）；完整案件说明只由 `GET /api/games/:id/case` 在玩家于前端主动展开（二次确认后）时下发。快照额外提供：
- `evidence[]`：物证明细（`name/desc/foundAt` 场景名），前端物证栏展示描述
- `caseResult`：**仅 `win` 阶段**携带的证据复盘 `{ got:[{text,holder}], missing:[{text,holder}], total }`（命中/未获取的关键证据），调查阶段为 `null` 不泄露

**叙事风格约束**：
- 诚实 NPC（非说谎者、非凶手）说话**坦然直接、配合调查**，不渲染心虚；只有说谎者/凶手在隐瞒时才有躲闪紧张的表现（提示词规则 4.2）
- narrative 字数弹性：**有实质进展 150~350 字 / 无进展 60~120 字**（替代原固定 300~500 字）

**物体操作延续硬约束**：线索与物证均以「线索·/物证·」前缀物品进入背包；装备、卸下、举证勾选等均由前端按钮完成，AI 只结算与演绎。

### 2.5 AI 交互实现详解

本节说明游戏与 AI 交互的三个核心问题：**如何连接 AI、如何把世界观交给 AI、如何约束 AI 的输出**。

#### 2.5.1 连接 AI（server/llm.js）

- 项目**不依赖任何 AI SDK**，使用 Node.js ≥18 内置的 `fetch` 直接请求 OpenAI 兼容的 `/chat/completions` 接口
- 请求参数来自环境变量（`.env`）：`LLM_BASE_URL`（服务地址）、`LLM_API_KEY`（密钥）、`LLM_MODEL`（模型名）
- 由于遵循 OpenAI 兼容协议，**只需改 `.env` 即可切换任意兼容服务**（OpenAI 官方、Sensenova、DeepSeek、国内中转等）
- 认证方式：标准 `Authorization: Bearer <API Key>` 请求头
- 60 秒超时自动中断，防止模型响应卡死

**当前请求参数（针对 sensenova 系列调优）：**

| 参数 | 值 | 为什么 |
|------|-----|--------|
| `temperature` | 0.9 | 剧情随机性，创意写作偏高 |
| `max_tokens` | 4096 | 官方推荐普通任务额度（2048~4096）；系统提示词+历史已占约 2000 token，2048 时输出被截断导致 JSON 解析失败、触发降级 |
| `reasoning_effort` | `"none"` | **关闭思考模式**（sensenova 思考默认开启，会抢占输出配额导致空内容） |
| `response_format` | `{type: "json_object"}` | 结构化输出，要求返回合法 JSON |

```js
// 核心调用（真实参数）
await fetch(`${cfg.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
  body: JSON.stringify({
    model, messages, temperature: 0.9, max_tokens: 4096,
    reasoning_effort: 'none',
    response_format: { type: 'json_object' },
  }),
});
```

#### 2.5.2 世界观与状态的传递（server/modes/world.js → buildSystemPrompt）

每次调用 AI 前，模式处理器会**按世界观能力动态构造**系统提示词（system prompt）：

| 提示词组成部分 | 内容 | 作用 |
|---------------|------|------|
| **角色设定** | "你是「{世界名}」的至高游戏主持人（Game Master）" | 定义 AI 的身份与职责（世界名来自 Theme） |
| **输出协议** | 必须输出指定结构的 JSON（见 2.5.3） | 让 AI 的返回可被程序解析 |
| **字段填写规则** | 按 `statSchema` / `itemCategories` **裁剪**的 delta 规则 | 无金币的世界不会有金币规则 |
| **物品操作权限** | AI 无权移动物品（仅当有物品类别时注入） | 物品移动一律由前端按钮完成 |
| **道具效果规则** | 食物回血、毒物扣血等（仅当有 item 类别时注入） | 无预设效果表，效果由 AI 判定 |
| **物品品质规则** | 武器「武器·名称[品质]」、防具「防具·名称[品质]」（仅当有武器/防具时注入） | 统一命名与稀有度 |
| **剧情原则** | 不替玩家做决定；含 hp 时才加死亡规则 | 保证玩法一致性 |
| **世界观** | `theme.intro` + `gmGuidelines` | 统一叙事背景，防止 AI 跑偏 |
| **当前状态** | 玩家姓名/等级/HP/金币/装备/背包（`renderPlayer()` 按能力裁剪） | 让 AI 知道实时数据，据此填 delta |
| **剧情回顾** | 最近 6 条对话历史 | 保证前后剧情连贯、承接上一回合 |

这套提示词在**每回合都重新生成**，因为玩家状态和历史在持续变化。它就是"游戏规则"和"AI 行为"之间的桥梁。

#### 2.5.3 约束 AI 输出（多层防护架构）

AI 是"尽力遵守协议"的，不能指望它永远正确。本项目用**五层防护**确保游戏稳定：

**第 1 层 · 协议约束（提示词中强制）**

提示词明确要求 AI 只输出如下 JSON（delta 字段按世界观裁剪），不得输出其他文字：

```json
{
  "narrative": "本回合剧情，300~500字，第二人称，结尾不替玩家做决定",
  "choices": ["建议选项A", "建议选项B", "建议选项C"],
  "delta": { "hp": 0, "gold": 0, "exp": 0, "inventory": ["获得的物品"] },
  "battle": true
}
```

并附带数值规则：hp 幅度 5~40、gold 幅度 1~50、exp 幅度 10~30、未发生的事填 0 或空数组、死亡时 delta.hp 恰好归零等。

> **物品操作权限**：delta 中只有 `inventory`（AI 赠送的新物品，进入背包）。**使用 / 丢弃 / 卸下 / 装备物品由玩家通过前端按钮完成并自动同步**，AI 无权移动任何物品（`removeInventory` / `weapon` / `armor` 字段已被后端硬性忽略），只负责在剧情中描写按钮动作并结算其效果（如食用食物 → hp 回血）。

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

**状态兜底（贯穿第 3-5 层）**：`normalizeDelta` + `applyDelta` 做数值规范化与钳制——HP 钳制 `[0, maxHp]`、金币不为负、背包上限 20、升级/死亡规则由后端强制执行。**即使 AI 返回异常数值，游戏状态也不会崩坏。**

> **五层防护的意义**：提示词"引导" → 参数"要求" → 解析"容错" → 重试"救回" → 降级"兜底"。每一层都为下一层的失效做准备，保证极端情况下游戏依然可玩。

### 2.6 关键知识点（踩坑总结）

1. **`response_format: json_object` 是软约束**：OpenAI 兼容接口的标准参数，但部分模型未真正实现。若需要硬约束，需换支持严格 JSON 模式的服务/模型。且使用时要确保提示词中包含 "json" 关键字与格式示例（官方要求）。
2. **sensenova 思考模式默认开启**：`reasoning_effort` 默认 `high`，思考内容与输出**共享 max_tokens 配额**。长剧情下配额被思考吃光 → `finish_reason: length` → 输出为空。解法：设 `reasoning_effort: "none"` 并提高 `max_tokens`。
3. **`thinking` 字段不等于 `reasoning_effort`**：部分文档提到的 `thinking: "disabled"` 在 sensenova 上**不受支持**（返回 HTTP 400）。关闭思考请用 `reasoning_effort: "none"`。
4. **测试必须模拟真实用户**：发"继续推进冒险N"这种无意义指令会让模型困惑，且降级产生的纯文本写回 history 会污染上下文、诱使模型模仿输出纯文本。应**读取 AI 返回的 choices 并选择其一继续**。
5. **降级文本要"隐晦"**：不要向玩家展示"AI 未按格式返回"等技术信息，用游戏内语言包装，保持沉浸感。
6. **物品移动必须是代码级硬约束**：提示词是软约束，模型仍会"演绎"剧情而擅自移动物品。因此把 `removeInventory` / `weapon` / `armor` 在 `normalizeDelta` 中**直接丢弃**，把物品移动权限完全收归前端按钮。

### 2.7 目录结构

```text
Whatever/
├── .env                  # 实际配置（含密钥，已 gitignore）
├── .env.example          # 配置模板（空值）
├── .gitignore
├── package.json          # 根：一键脚本
├── server/               # 后端
│   ├── index.js          # Express 入口 + 全部路由（按 mode 分发）
│   ├── engine.js         # 引擎共享层：JSON 解析 / 重试 / 降级 / 物品按钮操作
│   ├── casegen.js        # 探案：案件生成（真相 schema + 提示词 + 结构校验）
│   ├── modes/            # 游戏模式（可插拔）
│   │   ├── index.js      #   模式注册表
│   │   ├── world.js      #   大世界模式（提示词构造 / delta 应用 / 回合处理）
│   │   └── detective.js  #   探案模式（案件驱动：accuse/confront/snapshot 防剧透）
│   ├── themes/           # 世界观配置
│   │   ├── index.js      #   读取 / 规范化 / 纯文本 → Theme 的 AI 解析
│   │   └── azeroth.json  #   默认世界观模板（艾泽洛姆）
│   ├── llm.js            # LLM 网关：fetch 调用 + 配置读取
│   ├── storage.js        # JSON 存档读写
│   ├── quality.js        # 物品品质系统（普通/优秀/稀有/史诗/传说）
│   └── config.js         # 极简 .env 加载器
├── frontend/             # 前端
│   ├── vite.config.js    # 代理 /api → :3001
│   └── src/
│       ├── App.vue               # 薄壳：首页 / 游戏页切换 + provide('game')
│       ├── api.js                # 后端 API 薄封装
│       ├── composables/useGame.js# 模式无关的状态与操作层
│       ├── components/
│       │   ├── HomeView.vue      # 首页：模式/题材选择 + 文本导入 + 存档列表
│       │   ├── WorldView.vue     # 大世界模式游戏页：能力驱动的动态侧栏 + 对话流
│       │   └── DetectiveView.vue # 探案模式游戏页：案件说明/场景/在场人物/物证/线索/指认/举证
│       ├── main.js
│       └── style.css
├── data/                 # 游戏存档（运行时生成）
├── TECH_DOC.md           # 本技术文档
└── DEVELOPMENT_LOG.md    # 开发记录（问题排查与修复过程）
```

### 2.8 其他关键实现说明

- **前端交互**：输入框自由行动 + 推荐选项快捷点击；侧栏按能力显示 HP/金币/经验/装备/背包；等待提示与战斗/死亡状态标识
- **选项持久化**：AI 推荐选项随剧情存入存档历史，重进游戏不丢失
- **上下文裁剪**：对话历史超过 40 条时丢弃最早的记录，防止请求体无限膨胀、控制 token 消耗
- **存档可移植**：存档文件自带 `mode` 与 `theme` 字段，读档时自动还原玩法上下文

---

## 3. 如何启动

> 需要 **Node.js ≥ 18**，依赖已安装完毕（`node_modules` 已存在），无需重复 `npm install`。

### 3.1 两个终端分别启动（推荐）

```bash
# 终端 1 —— 后端（端口 3001）
cd server
npm start
# 看到 [文字冒险] 服务已启动 + LLM 配置状态: 已配置

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

**Q4：导入世界观提示解析失败**
→ 需后端已配置 LLM；文本尽量说明"是否有战斗/货币/装备"，或重试一次。

**Q5：端口被占用**
→ 参考"如何关闭"一节清理残留进程。

---

## 7. 后续可扩展方向

- ~~探案模式（案件 AI 生成、线索收集、物证反驳说谎 NPC、指认凶手与认罪）~~ ✅ 已实现，见 §2.4.5
- 探案模式增强：更多题材模板、案件难度分级、限时破案
- 更多内置世界观模板（赛博朋克、武侠、太空歌剧……）
- 多人在线（共享世界 / 实时协作冒险）
- 富文本渲染（物品/战斗高亮）、自动配图
- 数据库升级（SQLite）以支持多用户与查询
- 存档加密 / 云同步
