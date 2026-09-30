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

---


