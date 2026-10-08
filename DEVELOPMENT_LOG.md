# 开发记录（Development Log）

> 记录项目开发过程中的关键问题排查、方案决策与修复过程，供后人理解"为什么代码长这样"。

---

## 2026-09-29 · AI 输出格式不稳定问题排查与修复

### 问题现象

玩家游玩时频繁出现 `AI 处理失败：AI 返回了无法解析的内容，请重试一次`，游戏回合被强制打断。原因是 AI 模型**没有按约定输出 JSON**，而是直接输出了纯文本剧情。

### 根因分析

使用的模型 `sensenova-6.8-flash-lite`（商汤轻量模型）在复杂游戏上下文下，约 **2/3 概率**不遵循"只输出 JSON"的协议，直接输出散文。经多轮验证，这是**模型本身的格式遵循能力弱**，而非单一配置错误。

### 排查过程（关键实验记录）

#### 实验 1：强化系统提示词
- 做法：在 `buildSystemPrompt` 中新增「输出格式—最高优先级」「严格禁止」小节，明确禁止纯文本/代码块/截断 JSON
- 结果：隔离测试 1 次成功，但完整存档上下文下多次失败 → **提示词强化不够可靠**

#### 实验 2：协议级 `response_format: { type: 'json_object' }`
- 做法：请求体加入 OpenAI 标准结构化输出参数
- 结果：同一请求连续调用 6 次，仅约 1/3 返回 JSON → **该模型对 response_format 是"软约束"**

#### 实验 3：关闭思考模式（排查"空内容"）
- 现象：有时报 `LLM 返回了空内容`，`finish_reason: length`
- 根因：该模型**思考模式默认开启**（`reasoning_effort: high`），思考内容与输出**共享 max_tokens 配额**，配额被思考吃光导致 content 为空
- 验证：`max_tokens=100/300/600/1200` 均返回空，`max_tokens=2000` 正常 → 确认是配额截断

#### 实验 4：官方参数组合对比（写临时脚本多次调用）

| 组合 | 结果 |
|------|------|
| `thinking: "disabled"` + json | **HTTP 400**（该字段不受支持，直接拒绝请求） |
| `reasoning_effort: "none"` + json | **4/4 全部成功** ✅ |
| 两者都加 | HTTP 400（thinking 字段导致） |
| 仅 json（不关思考） | 1/4 不稳定 |

**结论**：官方文档推荐的关闭思考方式是 `reasoning_effort: "none"`（不是 `thinking` 字段）；配合 `response_format` 是当前最优参数组合。

#### 实验 5：测试方式反思（重要教训）

- 之前用 curl 发送"继续推进当前的冒险N"等**无意义指令**测试
- 结果：模型因指令无意义而困惑，且降级的纯文本写进 history 后**污染上下文**，模型开始模仿重复旧剧情，越测越糟
- 修正：模拟真实用户——**读取 AI 返回的 choices，点击其中一个选项继续**
- 教训：**测试必须模拟真实用户行为**，否则测试结果不可信

### 最终修复方案（三层机制）

```text
第一层 · 参数优化（提高 JSON 概率）
  reasoning_effort: 'none'   ← 关闭思考模式，避免截断
  response_format: json_object ← 结构化输出（软约束，尽力而为）
  max_tokens: 2048           ← 官方推荐的普通任务额度

第二层 · 自动重试（解析失败救回）
  首次解析失败 → 用【精简提示词】重试一次（不带冗长 history，
  只带玩家状态 + JSON 格式模板）→ 实测重试成功率 100%

第三层 · 降级兜底（永不卡死）
  重试仍失败 → 把纯文本剧情直接接续，不打断游戏
  前端用隐晦的游戏内语言过渡（"命运之线悄然转动"），
  不让玩家感知到技术细节
```

### 实测效果

```
6/6 回合全部成功，0 次降级
其中 4 次首次解析失败但自动重试救回 → 用户零感知
状态系统正常：hp 100→85（战斗受伤）、背包 3→5（获得物品）
```

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/llm.js](../server/llm.js) | `max_tokens` 800→2048；新增 `reasoning_effort: none` 与 `response_format: json_object` |
| [server/game.js](../server/game.js) | 新增自动重试逻辑（精简提示词）；降级分支改为不报错、直接接续；`buildSystemPrompt` 强化格式约束 |
| [frontend/src/App.vue](../frontend/src/App.vue) | 降级提示改为隐晦的游戏内语言 |

### 关联知识点（详见 TECH_DOC.md §2.4）

- OpenAI 兼容接口的 `response_format: json_object` 是**软约束**，需配合提示词中的 json 关键字，且部分模型不真正生效
- sensenova 系列**思考模式默认开启**且与输出共享 max_tokens 配额 → 输出可能被截断为空
- `thinking` 字段不受部分兼容服务支持（返回 400），关闭思考请用 `reasoning_effort: "none"`
- **测试必须模拟真实用户行为**（读 choices 选择继续），而不是发无意义指令

---

## 2026-09-30 · max_tokens 配额不足导致降级（ZD3）与修复

### 问题现象

玩家"ZD3"存档在探索湖中石台时出现 `命运之线悄然转动`（降级提示）。日志显示**首次解析失败 + 重试仍失败**，触发纯文本接续兜底。

### 根因分析

随着功能增多，系统提示词不断膨胀（新增品质规则、道具效果规则、装备说明），实测已达 **2852 字符**；加上 6 条历史后，**每次请求输入约 2028 token**。而输出配额仍是 `max_tokens: 2048`，模型需在一回合内输出 narrative(300~500字) + choices + delta，空间紧张 → 长剧情下输出被截断（无法闭合 JSON），导致解析失败。

### 修复方案

`max_tokens` 2048 → **4096**（官方推荐普通任务额度上限），共三处：

| 文件 | 位置 |
|------|------|
| [server/llm.js](../server/llm.js) | `chat()` 默认值 `opts.maxTokens ?? 4096` |
| [server/game.js](../server/game.js) | 首次请求 `{ maxTokens: 4096 }` |
| [server/game.js](../server/game.js) | 自动重试请求 `{ maxTokens: 4096 }` |

### 实测验证（模拟真实用户，读取 choices 继续）

- 复现 ZD3 场景（涉水前往湖中央石台 + 快捷按钮使用「干粮 x1」）→ `degraded: False`，剧情完整，干粮正确扣减，正常返回 JSON ✅
- 选择 AI 给出的选项继续第二回合 → 依旧 `degraded: False`，上下文连贯 ✅

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/llm.js](../server/llm.js) | `max_tokens` 默认值 2048→4096 |
| [server/game.js](../server/game.js) | 首请求与重试请求 `maxTokens` 2048→4096 |

---

## 2026-09-30 · 快捷按钮动作的联动 bug 修复（使用道具/卸下装备）

### 问题现象（玩家 ZDG 存档反馈）

1. 点击「干粮 x2」使用，但**整个条目被一次性扣光**（应只使用 1 个）
2. 卸下的防具**从背包消失**——AI 把"卸下皮甲"演绎成"留在石阶上"，还在 `removeInventory` 里把它移除
3. 结算后出现 `「干粮」（但背包中没有，可能已丢弃）` 报错——按钮已先移除干粮，AI 又按"使用道具必须 removeInventory"的规则重复移除，找不到物品

### 根因

| Bug | 根因 |
|-----|------|
| 道具一次用完 | `useItem` 直接用原始条目名（含 `x2`）扣减，一次移除了整个条目 |
| 装备消失 | 卸下的装备已在背包，AI 未收到"按钮动作已生效"的信息，把卸下当作"丢弃"写进 `removeInventory` |
| 重复移除报错 | 提示词要求"使用道具必须 removeInventory"，与按钮"先移除再交给 AI 结算"的机制冲突，AI 重复移除 |

### 修复方案

| 位置 | 改动 |
|------|------|
| [server/game.js](../server/game.js) `useItem` | 按钮点击**默认只使用 1 个**：带数量条目（如「干粮 x2」）按「干粮 x1」扣减；想一次用多个改用文字输入走 AI 结算 |
| [server/game.js](../server/game.js) `removeFromInventory` | 背包中完全找不到时改为**静默忽略**，不再提示"可能已丢弃"（按钮已移除的道具被 AI 重复声明时不再报错打扰玩家） |
| [server/game.js](../server/game.js) `buildSystemPrompt` | 新增【按钮快捷操作】小节：明确按钮动作已实际生效、状态已同步；已移除的道具/已卸下的装备**不得再写进 removeInventory**；换装只走 weapon/armor 字段 |

### 实测验证（模拟真实用户）

1. 点击「干粮 x2」→ 只扣 1 个，背包剩「干粮 x1」，待结算显示"使用「干粮 x1」" ✅
2. 卸下「防具·皮甲[普通]」→ 皮甲回背包，防具槽空 ✅
3. 提交行动（含按钮动作）给 AI → `effects: ['生命 +15']`，背包保留 `['干粮 x1', '防具·皮甲[普通]']`，**无任何"背包中没有"报错** ✅

### 存档修复（ZDG）

- `inventory: []` → `['干粮 x1']`（按钮本应只消耗 1 个干粮）
- `armor: null` → `'防具·皮甲[普通]'`（皮甲恢复装备）

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/game.js](../server/game.js) | `useItem` 默认用 1 个；`removeFromInventory` 找不到时静默；`buildSystemPrompt` 新增按钮动作规则 |

---

## 2026-09-30 · 物品操作权限架构调整（AI 无权移动物品）

### 背景

上一轮靠提示词约束 AI"不要重复移除按钮已处理的道具"，但**软约束不可靠**：玩家 ZDG 再次反馈「背包移除「防具·皮甲[普通]」」——AI 把"卸下皮甲"演绎成"留在岩壁上"，并写进 removeInventory 删除背包里的皮甲。提示词再强化也难以杜绝，因为模型总会按自己的理解"演绎"剧情。

### 决策：代码级硬约束

用户拍板：**所有物品的使用、丢弃、卸下、装备只能通过前端按钮操作**；对 LLM 只承担"告知义务"（让它知道物品已被操作、状态已同步），物品移动 AI 无权执行、也不会执行；使用道具后的效果结算仍依赖 AI。

这从"提示词软约束"升级为**代码级硬约束**——无论 AI 返回什么，物品移动都无法发生。

### 修复方案

| 位置 | 改动 |
|------|------|
| [server/game.js](../server/game.js) `normalizeDelta` | delta 只保留 `hp/gold/exp/inventory`；**`removeInventory` / `weapon` / `armor` 一律忽略** |
| [server/game.js](../server/game.js) `applyDelta` | 删除 removeInventory 处理与 switchSlot 换装逻辑；AI 给的武器/防具**统一进背包**，装备由玩家按钮完成 |
| [server/game.js](../server/game.js) `buildSystemPrompt` | JSON 模板去掉 removeInventory/weapon/armor；新增【物品操作权限】核心规则，明确 AI 无权移动物品 |
| [server/game.js](../server/game.js) `retryPrompt` | 精简重试提示词同样移除物品移动字段 |
| [server/game.js](../server/game.js) `discardItem`（新增） | 补齐「丢弃」操作：默认丢 1 个，记为待结算动作，支持撤销 |
| [server/index.js](../server/index.js) | 新增 `/api/games/:id/discard` 路由 |
| [frontend/src/App.vue](../frontend/src/App.vue) | 背包每个物品新增「丢弃」按钮（红色样式，提示可撤销） |
| [server/game.js](../server/game.js) `cancelPendingAction` | 撤销支持 `discard` 类型（与 `use` 一致，道具恢复） |

### 实测验证（模拟真实用户）

1. 卸下「防具·皮甲[普通]」→ 皮甲回背包，防具槽空 ✅
2. 提交行动给 AI（含"已操作"提示）→ 皮甲**保留在背包**，armor 槽保持空，无任何"背包移除" ✅
3. AI 获得新物品 → 只进背包，不自动装备 ✅
4. 丢弃「干粮 x2」→ 只丢 1 个，剩「干粮 x1」，待结算显示"丢弃「干粮 x1」" ✅
5. 撤销丢弃 → 「干粮 x2」恢复 ✅

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/game.js](../server/game.js) | `normalizeDelta`/`applyDelta` 硬约束；新增 `discardItem`；提示词更新；撤销支持 discard |
| [server/index.js](../server/index.js) | 新增 `/discard` 路由 |
| [frontend/src/App.vue](../frontend/src/App.vue) | 背包物品「丢弃」按钮 + 红色样式 |

> ⚠️ 上表中 `server/game.js` 与单文件版 `frontend/src/App.vue` 已在下一阶段的「多模式架构改造」中拆分/删除，迁移去向见下方最新条目。

---

## 2026-09-30 · 多模式架构改造（大世界模式 + 世界观系统）

### 背景与目标

原项目**写死了单一题材**：世界观固定为「艾泽洛姆」大陆，`server/game.js` 里硬编码了 hp/gold/exp、武器/防具槽位、战斗逻辑；前端 `App.vue` 是一个 900 余行的巨型组件。用户希望：

1. 把现有冒险游戏定位为**「大世界模式」**（自由探索、无胜利条件）；
2. 增加**可导入的自定义世界观**（不同题材，且未必有战斗/武器/防具）；
3. 为后续**「探案模式」**（有明确胜利条件）预留可插拔的模式框架。

### 关键决策（用户拍板）

| 决策项 | 结论 |
|--------|------|
| 世界观导入方式 | **纯文本粘贴**，由 AI 解析为结构化 Theme（不做文件上传/编辑器） |
| 通用化手段 | 用 **Theme.capabilities**（能力开关）驱动提示词与 UI，而非为每种题材写死分支 |
| 物品操作权限 | 延续上一轮**代码级硬约束**：AI 无权移动物品，只能"告知" |
| 旧存档兼容 | **不考虑，直接删除**旧存档与旧代码 |

### 架构迁移

```text
改造前                              改造后
server/game.js  ──删除──►  server/engine.js        （模式无关共享层：runTurn / 解析 / 物品操作）
                           server/modes/world.js    （大世界模式处理器）
                           server/modes/index.js    （模式注册表，探案模式只需在此登记）
                           server/themes/index.js   （世界观：列表 / 归一化 / 文本→Theme）
                           server/themes/azeroth.json（默认模板，原艾泽洛姆）

frontend/src/App.vue(910行) ──拆分──► App.vue        （薄壳：provide('game')）
                                      HomeView.vue   （首页：模式选择 / 世界观导入 / 存档）
                                      WorldView.vue  （游戏内：能力驱动的动态侧栏与背包）
                                      composables/useGame.js（全局响应式状态与业务动作）
                                      api.js         （统一请求封装）
```

- **模式契约**：每个模式导出 `modeId / modeName / needsTheme / newGame / processAction / buildSystemPrompt / renderPlayer / summarize / 物品操作系列`，`server/index.js` 仅做 `findGame → mode.xxx` 分发。
- **能力驱动 UI**：前端按 `theme.capabilities` 决定是否渲染金币 / 武器槽 / 防具槽 / 战斗条，无战斗世界自动隐藏武器防具，侧栏只剩「等级 / 生命」。

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/game.js](../server/game.js) | **删除**，逻辑拆分至 engine.js + modes/world.js |
| [server/engine.js](../server/engine.js) | 新增：模式无关的 LLM 回合、JSON 容错解析、物品操作原语 |
| [server/modes/world.js](../server/modes/world.js) | 新增：大世界模式（提示词按 capabilities 拼装、delta 归一化与应用） |
| [server/modes/index.js](../server/modes/index.js) | 新增：模式注册表 |
| [server/themes/index.js](../server/themes/index.js) | 新增：世界观列表 / 归一化 / 纯文本解析 |
| [server/themes/azeroth.json](../server/themes/azeroth.json) | 新增：默认世界观模板 |
| [server/index.js](../server/index.js) | 路由改为按 `game.mode` 分发；新增 `/api/modes`、`/api/themes`、`/api/themes/parse` |
| [frontend/src/App.vue](../frontend/src/App.vue) | 瘦身为薄壳组件 |
| [frontend/src/components/HomeView.vue](../frontend/src/components/HomeView.vue) | 新增：模式/世界观选择、文本导入、存档列表 |
| [frontend/src/components/WorldView.vue](../frontend/src/components/WorldView.vue) | 新增：能力驱动的游戏界面 |
| [frontend/src/composables/useGame.js](../frontend/src/composables/useGame.js) | 新增：全局状态与业务动作 |
| [frontend/src/api.js](../frontend/src/api.js) | 新增：API 封装 |

### 实测验证（浏览器 + API 端到端）

1. 首页正确渲染模式卡片、世界观卡片、文本导入折叠区、存档列表 ✅
2. 艾泽洛姆开局：等级/生命/金币 + 武器·旧铁剑 + 防具·皮甲 + AI 开场剧情与选项 ✅
3. 物品使用（干粮 x2 → x1，生成可撤销的待结算动作）✅
4. 存档列表显示「艾泽洛姆 · Lv.1」✅
5. 自定义世界观导入（粘贴无战斗现代文本 → AI 解析为「雾港」）：侧栏只剩「等级 / 生命」，无金币 / 武器 / 防具 / 背包物品，AI 生成刑侦题材开场 ✅
6. 控制台无错误；`npm run build` 通过（17 modules，退出码 0）✅

### 关联知识点（详见 TECH_DOC.md §2.4）

- 用「能力开关 + 数据驱动」替代「题材分支」，一份引擎适配任意世界观
- 模式注册表模式：新增模式理想情况下**无需改动任何路由代码**
- 前端 `provide/inject` + `reactive` 单例状态，避免多组件间 props 层层透传

---

## 2026-09-30 · 探案模式实现（案件引擎 + 模式后端 + 侦探前端）

### 背景与目标

在大世界模式之上新增第二个可插拔模式。用户原始需求一句话概括：**物证用于在调查时辨别线索真假，随时可以指认凶手，线索最终用于让凶手认罪，认罪成功则游戏胜利。**

### 关键决策（用户拍板两轮确认）

| 决策项 | 结论 |
|--------|------|
| 世界观导入 | 纯文本粘贴、AI 解析（沿用） |
| 物证槽 | **单槽**：同时持 1 件 |
| 指认机制 | **两步**：先指认，再举证认罪 |
| 实施顺序 | 分两阶段：先大世界改造（已完成）→ 再探案模式 |
| 真相掌控 | **代码持有真相，AI 只演绎**（防真相漂移） |
| 线索/物证承载 | 沿用背包 + 装备槽（「线索·」「物证·」前缀） |
| 认罪判定 | **代码硬判定 + AI 叙事** |
| 案件入口 | **先选题材，再一键生成** |
| 数值规则 | 初始 HP 100；指认失败每次 -25（清空则失败）；认罪举证失败**不扣血且线索不消耗**；场景切换按钮 + 文字双通道 |
| 旧存档兼容 | 不考虑，直接删除 |

### 架构落地（阶段 A/B/C）

```text
阶段 A · 案件引擎
  server/casegen.js    案件 AI 生成：真相 schema 提示词 + normalizeCase 结构校验
                       （normalizeCase 用「线索归属表」确定性剔除凶手名下的 keyClues，
                        因为模型惯于误选凶手口供为关键线索，而凶手口供玩家永远拿不到）

阶段 B · 探案模式后端
  server/modes/detective.js
    newGame(name,{genre})      题材 → AI 生成案件 → 初始化局面
    processAction / accuse / confront
    resolveRebuttal            物证击破谎言：代码确定性判定（装装备证 + 在场说谎者 + rebuts 命中）
    snapshot()                 剔除全部真相字段（isCulprit/isLiar/truth/culpritId/keyClues/crime）
    useItem/discardItem        恒 {ok:false}（探案模式物品只能由装备/举证按钮操作）
  server/index.js              新增 /api/genres、/api/games/:id/case、/accuse、/confront

阶段 C · 侦探前端
  frontend HomeView.vue        探案模式卡片 + 题材选择 + 开始查案
  frontend DetectiveView.vue   侧栏：阶段/生命/案件说明折叠/场景/在场人物/物证槽/线索
                               主区：剧情流 + 指认面板 + 举证面板（勾选线索）
```

### 关键机制与踩坑

1. **案件说明折叠（含谜底二次确认）**
   - 初版用 `<details>` + `@toggle.prevent`，导致折叠状态下二次确认提示不可达、确认后不加载真相
   - 改为**受控 div + 语义化 button**：`toggleCase()` 未确认时只展开到「剧透警告」，`confirmCase()` 确认后才调 `GET /case` 展示真相 ✅
2. **快照防剧透**：`snapshot()` 剔除真相后，前端通过 Debug 无法窥探凶手（实测响应体无 `truth`/`isCulprit`）✅
3. **keyClues 归属校验**：`validateCase` 强制关键线索"不得来自凶手"、"至少 1 条来自说谎者真话"，否则重生成；实测生成 5/5 通过 ✅
4. **首页卡片小视口不可达**：`.home` 用 `align-items:center` 垂直居中，卡片高于视口时顶部溢出且无法滚动 → 移除居中、`.home-card` 改 `margin:auto` ✅

### 实测验证（浏览器 + API 端到端，模拟真实用户）

1. 案件生成：选「现代都市」+ 名字 → AI 设计「都市午夜坠落谜案」，快照响应无剧透 ✅
2. **场景切换**：点场景按钮「28层员工通道监控室」→ 代码切换 + AI 演绎到达叙事 ✅
3. **收集线索/物证**：勘查现场 → 程序结算「发现物证」，入背包；「装备」按钮移入单槽物证槽 ✅
4. **物证击破说谎者**：装备「顶层公寓门禁刷卡记录」并当面向说谎者赵晴出示 → `物证击破了「赵晴」的谎言`，真话线索入背包、撒谎原因交代、假线索标记「谎话」 ✅
5. **误导性假线索**：凶手谎称「我当晚一直在办公室」，举证时被标记「谎话」（false）状态 ✅
6. **两步指认-失败路径**：连续 4 次错误指认 → HP 100→75→50→25→0，阶段「调查终止」，终局「💀 调查到此为止」 ✅
7. **两步指认-举证失败**：对质中提交非关键线索（0/3 命中）→ 「举证失败」，**HP 不变、线索不消耗** ✅
8. **两步指认-成功路径**：正确指认凶手 → 进入「对质阶段」，勾选关键线索举证 → 「举证成立（关键线索 2/3），凶手认罪」→「🎉 案件告破」 ✅
9. `npm run build` 前端构建通过；控制台无错误 ✅

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/casegen.js](../server/casegen.js) | 新增：案件生成提示词 + 真相 schema normalize/validate |
| [server/modes/detective.js](../server/modes/detective.js) | 新增：探案模式（约 830 行），确定性结算 + 防剧透快照 |
| [server/modes/index.js](../server/modes/index.js) | 注册 `detective` 模式 |
| [server/index.js](../server/index.js) | 新增 `/api/genres`、`/case`、`/accuse`、`/confront` 路由 |
| [frontend/src/components/HomeView.vue](../frontend/src/components/HomeView.vue) | 探案模式卡片 + 题材选择；修复小视口卡片不可达 |
| [frontend/src/components/DetectiveView.vue](../frontend/src/components/DetectiveView.vue) | 新增：探案界面（案件说明折叠/指认/举证/场景按钮/物证槽） |
| [frontend/src/composables/useGame.js](../frontend/src/composables/useGame.js) | 探案状态字段与 `loadCase/accuseSuspect/submitConfront` |
| [frontend/src/api.js](../frontend/src/api.js) | `listGenres/getCase/accuse/confront` |
| [frontend/src/App.vue](../frontend/src/App.vue) | 按 `mode === 'detective'` 切换 DetectiveView |

### 关联知识点（详见 TECH_DOC.md §2.4.5）

- **真相代码持有**：AI 只演绎不决定结局，杜绝"硬编的凶手在叙事里被改写"
- **确定性结算收归程序**：场景切换/物证发现/击破谎言由代码判定，交 AI 会出现"叙事卡死、对方不松口"
- **关键线索归属表**：keyClues 必须能被玩家真的拿到（非凶手、含说谎者真话），否则认罪闭环断裂

---

## 2026-09-30 · 探案体验优化（物证击破扩展到凶手 / 诚实NPC基调 / 无效行动拦截 / 字数弹性）

### 背景（用户反馈）

1. 盘问凶手时（尚未指认），其假证词**不在线索里显示为谎言**——用户希望：只要撒谎（无论出于私心还是他就是凶手），有对应物证就能当场揭穿；部分假话没有物证没关系。
2. 推进剧情**过于疑神疑鬼**：好像每个人心理都有鬼，且存在大量无效推进/无效探索。

### 关键决策（用户拍板）

| 决策项 | 结论 |
|--------|------|
| 物证击破范围 | 扩展到**任何人（含凶手）**；凶手被击破后改口，但新线索**不直接指向自己**（承认到过现场/有接触，绝不自证杀人） |
| 凶手部分假话无物证 | 可接受（不会直接导致凶手暴露） |
| 告破复盘 | 终局展示**已命中的关键证据 + 未获取的关键证据**（含持有人） |
| 物证描述 | 物证栏显示 `desc`（后端快照新增 `evidence[]` 明细） |
| 叙事风格 | 诚实 NPC 坦然配合；有进展回合 150~350 字、无进展 60~120 字 |

### 实现要点

**物证击破扩展到凶手**（[server/modes/detective.js](../server/modes/detective.js)）：
- `resolveRebuttal` 与 `applyDelta` 的 rebut 分支：移除 `su.isLiar` 限制，物证 `rebuts` 命中任何在场嫌疑人（含凶手）即可击破
- `casegen.js` 生成规则：要求凶手至少 1 件对应物证可拆穿；凶手的 `onRebuttal` 只能"部分坦言"；`presentStatementList` 对凶手 truth=true 口供在被击破前同样拦截
- `addClue`：说话人已被击破时，新口供直接按其真伪标记（修复"击破当轮新获真话 status=unknown"）

**告破复盘 caseResult**：
- `confront` 成功构建 `{got, missing, total}`；快照在 `win` 阶段重建（调查阶段返回 null 不泄露 keyClues）
- 前端 win 面板展示「📋 证据复盘」

**无效行动拦截 `quickNoopReply()`**：
- 盘问**已问尽的诚实 NPC**（口供全取得且非说谎者/凶手）→ 直接返回「我知道的都告诉你了…」+ 引导选项
- 重复搜索**已搜遍场景**（无未发现物证）→ 「这里确实没有更多发现了」
- **不调 LLM**，杜绝无效回合的悬疑注水

**叙事风格约束**：提示词新增规则 4.2（诚实 NPC 坦然直接）；narrative 字数弹性（150~350 / 60~120）；`presentStatementList` 标注"已无可取得的口供（诚实配合，已全部告知）"

### 实测验证

1. 凶手林绍之被「天台边缘湿泥脚印」击破 → 改口「我没有任何理由杀他」（部分坦言，不直接自证）✅
2. 说谎者周婉清被「车库门禁刷卡记录」击破 → c1 标「谎话」、真话标「已证实」✅
3. 告破复盘「关键证据 3/3」列出 3 条命中线索；构造缺 1 条时 `missing` 正确列出；investigate 阶段 caseResult=null ✅
4. 物证栏显示 desc 描述 ✅
5. 盘问已问尽诚实 NPC → 46~55 字短反馈 + 引导选项（未走 LLM）✅
6. 搜索已搜遍场景 → 「这里确实没有更多发现了」✅
7. 有进展回合 narrative 174~215 字（原 300~500）✅

---

## 2026-09-30 · 修复：死者混入嫌疑人导致"永远拿不到的关键证据"

### 问题现象（用户存档反馈）

用户存档的终局复盘出现一条**无法获得**的关键证据：「（女管家王阿姨）我22:40给凌女士送宵夜时门是开着的…」（凌婉清）。

### 根因

案件生成时，模型把**死者本人（凌婉清）也写进了 `suspects`** 并配了口供（c2）。`normalizeCase` 的 keyClues 排除逻辑只排除了**凶手名下**线索（`clueOwnedByCulprit`），**未排除死者名下**。玩家无法盘问死人 → keyClues 里的 c2 永远拿不到 → 终局复盘显示"无法获得的关键证据"。

### 修复（[server/casegen.js](../server/casegen.js)）

| 层 | 改动 |
|----|------|
| 生成提示词 | 规则 1.1/6/7：死者绝不能出现在 suspects；死者言论只能由活着的证人转述；keyClues 必须来自可盘问的活人；npcs 不得含死者 |
| `normalizeCase` | 归一化后按「与 `victim.name` 同名 / identity 含 受害·死者·被害人」**确定性剔除死者嫌疑人**，其口供作废，keyClues 引用自动丢弃 |
| `validateCase` | 新增校验：发现死者混入直接反馈模型重试 |

### 实测验证

- 单元测试：构造「死者凌婉清混入」原始输出 → normalizeCase 正确剔除，keyClues 的 c2 自动清除 ✅
- 真实生成 ×3：嫌疑人**均不含死者**、凶手**均可被物证拆穿**、keyClues **全部可盘问取得** ✅

> ⚠️ 该修复只对**新生成的案件**生效；含 bug 的旧存档（已 win）无法追溯修复，已删除。

---

## 2026-09-30 · 新增探案题材「蒸汽时代」

### 改动

`server/casegen.js` 的 `GENRES` 新增：

```js
{ id: 'steampunk', name: '蒸汽时代', hint: '维多利亚式欧洲，浓雾煤气灯下的伦敦，马车、怀表、煤气管道与早期工业化；侦探凭观察、推理与物证破案，氛围古典冷峻' }
```

前端题材卡片由 `/api/genres` 动态渲染，**无需改前端代码**。

### 实测验证

- `/api/genres` 返回 5 个题材 ✅
- 真实生成「雾夜怀表的第七响」：1887 年伦敦、煤气灯浓雾、苏格兰场委托、自鸣钟与蒸汽装置，夏洛克风格完整 ✅
- 沿用死者修复：嫌疑人不含死者、keyClues 全部可盘问 ✅

---

## 2026-10-08 · 探案：keyClues 自动修复兜底 + 案卷详情扩充

### 背景

1. **案件生成反复重试**：轻量模型时常漏选"说谎者的真话"作为关键线索，触发「keyClues 至少 1 条来自说谎者真话」校验失败，被迫全文重写重试（一次生成最多耗 20+ 秒）。
2. **案卷信息不全**：玩家展开案件说明后只能看到"谁、什么身份、什么关系"，看不到凶手/说谎者标识、撒谎动机、被击破后的反应、口供真伪与关键证据清单。

### 关键决策（用户拍板）

| 决策项 | 结论 |
|--------|------|
| 修复方式 | **确定性兜底而非重试**：`normalizeCase` 直接从已归一化的口供中补选说谎者真话，不再依赖模型全文重写 |
| 案卷详情 | 前端案卷展示：凶手/说谎者标签、撒谎动机、被击破后反应、每条口供真伪标记、「关键证据（足以锁定凶手）」清单（含持有人） |

### 实现要点

**keyClues 自动修复**（[server/casegen.js](../server/casegen.js) `normalizeCase`）：
- 若 keyClues 没有说谎者真话 → 自动补选 1 条；不足 2 条时从非凶手真话中补足；上限 4 条
- `MAX_ATTEMPTS` 3 → 5（仍失败时留更多重试空间）
- `validateCase` 该条报错信息改为列出说谎者名单并给出修法，方便模型定向修正

**案卷详情**（[frontend/src/components/DetectiveView.vue](../frontend/src/components/DetectiveView.vue)）：
- 嫌疑人条目：`凶手`/`说谎者` 标签、撒谎动机（lieMotive）、被击破后的反应（onRebuttal）、口供逐条「真/假」标记
- 新增「关键证据（足以锁定凶手）」小节：按 `keyClues` 反查口供文本与持有人展示

### 实测验证

- 单元测试：构造"模型漏选说谎者真话"的原始输出（keyClues 只有诚实 NPC 真话）→ `normalizeCase` 自动补上说谎者真话，`validateCase` 返回 PASS ✅
- 真实生成《高层公寓的沉默》：keyClues=[c3、c10（说谎者王慧真话）、c13、c14]，一次通过结构校验 ✅

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/casegen.js](../server/casegen.js) | `normalizeCase` keyClues 自动补选；`MAX_ATTEMPTS` 3→5；`validateCase` 报错更明确 |
| [frontend/src/components/DetectiveView.vue](../frontend/src/components/DetectiveView.vue) | 案卷详情扩充（标签/动机/击破反应/口供真伪/关键证据清单）+ 样式 |

---

## 2026-10-08 · 修复：文字通道场景移动不命中（简称/省略前缀）

### 问题现象

玩家输入「前往物业前台」无法触发场景移动——AI 在叙事里描写"你进入物业前台"，但 `detective.currentScene` 仍是 `sc1`，叙事与状态不一致。复现：真实生成案件《高层公寓的沉默》中，场景名「云岭大厦物业前台」，玩家省略公共前缀说简称就匹配不上。

### 根因

`matchScene` 的旧实现把场景名按分隔符拆成整词（如「云岭大厦」「物业」「前台」）再逐一 `includes` 匹配，要求玩家输入**原样包含某个完整分词**；「物业前台」不包含「云岭大厦」也不包含独立的「物业」+「前台」连续词（拆词后「物业前台」被拆散），因此落空。

### 修复方案（[server/modes/detective.js](../server/modes/detective.js)）

`matchScene` 重写为三级匹配：

```text
1. 场景 id     「去 sc2」直接命中
2. 完整场景名   「前往云岭大厦物业前台」原样命中
3. 移动意图词 + 场景独有片段
   独有片段 = 与其余场景名不重叠的 2~6 字连续子串（「物业前台」「消防通道」）
   必须含 前往/回到/去/到 等移动意图词才做片段匹配（防止"提及场景名"被误判为移动）
   双字强动词放宽到 2 字片段；单字动词（去/到/回）只匹配 ≥3 字片段，降低误触发
```

`matchScene` 同时加入 module.exports，供单元测试与工具层复用。

### 实测验证

- 单元测试 16 项全部通过：11 正例（含「前往物业前台→sc2」「去顶层走廊→sc3」「来到客厅→sc1」）+ 5 负例（「物业前台的门禁记录说明什么」「你在这四处看看」等均不误触发）
- `processAction` 内存路径验证 4 项：简称/全名/片段+意图词/返回起点均正确移动 `currentScene` ✅

### 涉及代码文件

| 文件 | 改动 |
|------|------|
| [server/modes/detective.js](../server/modes/detective.js) | `matchScene` 重写（`MOVE_VERBS` + `uniqueFragments`）；导出 `matchScene` |

> ⚠️ 3001 端口需重启服务后生效；文字通道场景移动判定发生在 LLM 调用之前，移动后即使 LLM 限流/失败，位置也已正确更新。



