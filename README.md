# 🎲 万象工坊

AI 驱动的创作世界：四种文字冒险模式 + 绘图工作台 + 办公助手，一个项目三种玩法。

## ✨ 功能总览

| 模块 | 说明 |
|---|---|
| 💬 AI 助手 | 流式对话（逐字渲染+思考过程实时展示）+ 历史会话管理（可折叠毛玻璃侧栏，SQLite 持久化，发送首条消息才建会话，支持一键清空）+ Markdown 渲染 + 共享元素飞入动效 |
| ⚔️ 文字冒险 | 四种模式：大世界（自由探索）/ 探案（找凶手）/ 狼人杀（5 人局推理）/ 推理杀（法官视角 7-10 人局甄谎推理）|
| 🎨 绘图工作台 | 文生图 + 图片编辑（图生图），商汤 U1.5 系列模型，历史 24 小时保留 |
| 📊 办公助手 | 信息图（12 布局 × 12 风格）+ 简历图（AI 背景 + 程序化文字渲染，文字 100% 准确）+ 图表解读（多模态分析）+ Excel 分析 + 报告网页化 + 报告写作 + PPT 演示文稿（标准风格 / dazzle 动态演示：入场动画+渐变装饰+进度条）+ 文档解析（docx / PDF，PDF 支持矢量网格表格识别转 Markdown） |

账号体系：用户名密码注册登录（SQLite + JWT），存档与图片按用户隔离；支持管理员（.env 指定）——用户列表/在线状态与历史/级联删除/重置密码。

## 🚀 快速开始

```bash
# 1. 配置密钥：项目根目录创建 .env
#    LLM_BASE_URL / LLM_API_KEY / LLM_MODEL（对话模型）
#    IMAGE_API_KEY（生图，可选，缺省回退 LLM_API_KEY）

# 2. 安装依赖（前后端一起）
npm install && cd frontend && npm install && cd ..

# 3. 开发模式启动（两个终端）
npm start          # 终端 1：后端，端口 3001
cd frontend && npm run dev   # 终端 2：前端 Vite，端口 5173
# 浏览器访问 http://localhost:5173

# 4. 生产模式
cd frontend && npm run build   # 前端构建为静态文件，由后端托管
pm start                       # 只需访问 http://localhost:3001
```

详细的环境搭建与服务器部署见《服务器开发与部署》。

## 📚 文档导航

项目文档共六类，全部位于 `docs/` 目录（README 除外）：

| 文档 | 内容 | 适合谁读 |
|---|---|---|
| [docs/文字冒险.md](docs/文字冒险.md) | 四种游戏模式的技术实现：前端组件、后端引擎、AI 提示词设计、存档机制、学习课程、发展评估 | 想理解游戏玩法实现的开发者 |
| [docs/绘图工作台.md](docs/绘图工作台.md) | 图像生成管线、HMAC 签名 URL 鉴权、浏览器缓存、历史管理、限速机制 | 想理解图像功能的开发者 |
| [docs/办公助手.md](docs/办公助手.md) | 信息图/简历图生成、商汤开源技能移植方法、提示词体系、与绘图管线的复用关系 | 想扩展办公能力的开发者 |
| [docs/服务器开发与部署.md](docs/服务器开发与部署.md) | 开发环境搭建、生产环境部署（Caddy + pm2 + systemd）、安全加固、移动端方案、全部踩坑记录 | 需要部署本项目的运维/开发者 |
| [docs/开发记录.md](docs/开发记录.md) | 按时间线的完整开发历程：每个功能的设计思路、实现过程、踩坑与修复验证 | 想了解『为什么代码长这样』的人 |
| README.md（本文档） | 项目简介、快速开始、文档导航 | 所有人 |

## 🛠️ 技术栈

- **前端**：Vue 3（Composition API）+ Vite 6，无 UI 框架
- **后端**：Node.js 20（内置 fetch，零重依赖）+ Express
- **数据库**：SQLite（better-sqlite3，WAL 模式）
- **AI**：商汤 SenseNova（LLM 对话 + U1.5 图像生成），OpenAI 兼容协议
- **部署**：pm2 守护 + Caddy 反向代理（HTTPS）+ systemd

## 📄 目录结构

```
├── server/          # 后端：index.js（路由）、llm.js / image.js / draw.js / office.js（AI 封装）、
│                    #       auth.js（鉴权）、storage.js（SQLite）、modes/（游戏模式）、tests/
├── frontend/        # 前端：src/components/（视图组件）、src/composables/useGame.js（状态）、src/api.js
├── data/            # 运行时数据：game.db（SQLite）、draw/（生成图片，gitignore）
├── docs/            # 项目文档（六类）
└── .env             # 密钥配置（gitignore）
```
