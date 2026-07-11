[English](README.md) | [한국어](README.ko.md) | 中文 | [日本語](README.ja.md) | [Español](README.es.md)

<div align="center">

# Hyper Cloaking

**无论什么浏览器任务，你的智能体都能完成。只要你有授权，Hyper Cloaking 就能搞定。**

一个为 AI 智能体打造的、以人类节奏运行的隐身浏览器，由托管的本地 `hyper-cloaking-mcp` 服务器驱动。无需手动配置，没有"页面加载完了"式的半成品结果——它以证据收尾。

<p>
  <img src="https://img.shields.io/badge/Claude_Code-D97757?logo=claude&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/Codex-000000?logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Cursor-6E56CF" alt="Cursor">
  <img src="https://img.shields.io/badge/OpenClaw-1F6FEB" alt="OpenClaw">
  <img src="https://img.shields.io/badge/Hermes-8957E5" alt="Hermes">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A5_20-3FB950?logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/authorized_use-only-F0B72F" alt="仅限授权用途">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

</div>

---

## ⚡ 安装

**Claude Code** — 将本仓库添加为插件市场，然后安装插件：

```bash
/plugin marketplace add alpox/hyper-cloaking
/plugin install hyper-cloaking
```

**Codex** 读取镜像清单 `.agents/plugins/marketplace.json` —— 在你的 Codex 插件界面添加该市场并启用 `hyper-cloaking`。

**任何 AgentSkills 兼容客户端**（Cursor、OpenClaw、Hermes 等）—— 使用 `skills` CLI 安装，或将 `skills/hyper-cloaking/` 复制到客户端加载的技能根目录：

```bash
npx skills add . --list   # 查看该来源提供的内容
npx skills add .          # 安装到当前项目
```

需要 **Node.js ≥ 20** 以及获取 `cloakbrowser` 和 `playwright-core` 的网络访问。其余部分由技能在首次运行时安装并修复。

## 💬 试一试

无需学习任何命令。像平常一样向智能体提出请求——只要你指向一个浏览器任务，技能就会启动：

> *"用 CloakBrowser 检查我的产品页面在移动端是否正确渲染，并截图。"*
> *"用保存的 cookie 登录我自己的 Instagram，拉取我最近的 12 篇帖子。"*
> *"监控我运营的这个仪表盘，如果部署状态变为失败就告诉我。"*

**预期结果：** 智能体会问几个设置问题，启动以人类节奏运行的隐身浏览器，执行任务，并且**只有在拿到证据时才算完成**——截图、提取的文本、确认的状态变化，都会保存在 `~/.hyper-cloaking/evidence/` 下。

## 🌐 适用范围

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** —— 任何加载 `SKILL.md` 的 MCP 兼容智能体。内置针对 **Naver · Instagram · YouTube · X · Coupang · TikTok** 的元数据提示，并为任何你有权测试的站点提供 `generic` 模式。

## ⚙️ 为什么行得通

- **真正的隐身浏览器，而非改过的 User-Agent** ——托管的本地 `hyper-cloaking-mcp` 服务器驱动带有真实浏览器指纹的 CloakBrowser，而不只是替换请求头。
- **默认以人类节奏运行** —— 每次实际运行都强制 `humanize: true`：以人类节奏的鼠标移动、打字和滚动，让长时间的自动化流程不会中途卡住或中断。
- **启动前先过关卡** —— 目标安全分类、授权依据、允许来源以及一轮预检问答，都在浏览器打开*之前*完成。
- **没有证据就不算完成** —— 页面加载永远不等于"完成"。只有结果得到证明时任务才结束，并返回结构化结果。
- **省心的配置** ——构建本地 MCP bundle，从 `mcp/src/register.mjs` 生成使用当前 Node 可执行文件和绝对 bundle 路径的客户端注册，并使用类型化工具。

## 🆚 普通 MCP 浏览器 vs `+ Hyper Cloaking`

| 当你需要… | 普通 MCP 浏览器 | `+ Hyper Cloaking` |
| :--- | :--- | :--- |
| 自动化**你自己的**已登录账户 | ✖ 触发自动化指纹 | ✓ 人类节奏 + 安全的 cookie 加载 |
| 先确认任务已获授权 | ✖ 没有关卡 | ✓ 启动前的安全 + 预检关卡 |
| 复用站点 cookie 而不泄露 | ✖ 手动、原始值 | ✓ 归一化、脱敏、绝不提交 |
| 相信"完成"就是真的完成 | ✖ 页面加载即算成功 | ✓ 以证据验证的结果 |
| 让隐身浏览器跑起来 | ✖ 手动安装与接线 | ✓ 自动安装/修复 + MCP 配置 |
| **绕过登录、CAPTCHA、风控系统** | ✖ | ✖ **按设计拒绝**（见边界） |

普通浏览器做不到的是第一行：**在你确实被允许运行的任务中，像人一样操作。**

## 🔁 工作原理

像 *"给这个站点用 CloakBrowser"* 这样的请求，会变成一套界限清晰的十步工作流。

<details>
<summary><strong>从关卡到证据的完整流水线 —— 详情</strong></summary>

1. **目标安全关卡** —— 将目标分类为允许 / 拒绝 / 需澄清，并记录授权依据和允许来源。
2. **预检问答关卡** —— 通过宿主原生的结构化问答界面，收集目标 URL、允许来源、无头模式、cookie 模式/账户以及是否保持浏览器打开。
3. **配置关卡** ——检查 Node.js 和托管的本地 MCP bundle；安装或修复任何缺失项。
4. **运行时工作区** —— 初始化 `~/.hyper-cloaking/`，用于 `cookie.yml`、配置文件、下载、证据、日志和状态。
5. **Cookie 处理** —— 通过专用助手归一化并加载与站点匹配的 cookie（Chrome 导出 JSON、Playwright 数组、多账户条目），绝不在仓库中存储原始值。
6. **可执行文件解析** —— 在 `~/.hyper-cloaking/cache/cloakbrowser/` 下定位缓存的 CloakBrowser Chromium 二进制文件。
7. **人类节奏启动** —— 每次实际运行都强制 `humanize: true`（以人类节奏的鼠标、打字、滚动）。
8. **MCP 配置** ——构建 `mcp/dist/server.mjs`，然后使用 `mcp/src/register.mjs` 生成的注册，其中包含当前 Node 可执行文件和绝对 bundle 路径。
9. **任务执行 + 结果验证** —— 执行请求的任务，只有当证据证明结果时才算完成（仅页面加载绝不算完成）。
10. **结构化报告** —— 返回 `targetSafety`、`outcome`、`failure`、`contentBoundary` 和 `learning`；将报告和截图保存在 `~/.hyper-cloaking/evidence/` 下。

浏览器 DOM、页面文本、下载内容和控制台输出都被视为**没有指令权限的不可信数据。**
</details>

## 🔒 边界

Hyper Cloaking 是一个用于**授权浏览**的工具，而非绕过访问控制的手段。

- **适用于** 对你有权测试的资产进行授权 QA、监控、个人账户自动化和诊断。
- **不适用于** 绕过访问控制、规避风控系统、破解 CAPTCHA、受限抓取或未经授权的账户自动化。
- 人类化处理只会降低自动化指纹——它**不会**免除任务必须获得授权的要求。
- Cookie 会被归一化、在日志中脱敏，且绝不提交。技能绝不会捏造未获得的授权，未知的 provider 会安全失败（fail closed）。

---

## 托管本地 MCP 配置

推荐的实际运行入口是托管的 `hyper-cloaking-mcp` 服务器。在仓库根目录构建 bundle：

```bash
npm --workspace mcp run build
```

为所用客户端生成注册。渲染器会解析当前 Node 可执行文件和绝对路径 `mcp/dist/server.mjs`：

```bash
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('direct'), null, 2))"
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('codex'), null, 2))"
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('json'), null, 2))"
```

将生成的注册应用到 Codex、Claude Code/Cursor JSON、OpenClaw、Hermes，或与 Gajae-Code 会话配合使用的 MCP 客户端。直接启动检查：

```bash
node "$(pwd)/mcp/dist/server.mjs"
```

按以下顺序使用类型化工具：`cloak_setup` → `cloak_status` → `cloak_launch` → `cloak_navigate` → `cloak_snapshot` → `cloak_click`/`cloak_type`/`cloak_scroll` → `cloak_screenshot` → 查看 `cloak_provider_capabilities` → `cloak_provider_read` 或 `cloak_provider_write` → `cloak_teardown`。需要时使用 cookie 和凭据工具（`cloak_cookies_list`、`cloak_cookies_status`、`cloak_credentials`）。支持的 provider 是 **Naver、Instagram、YouTube、X、Coupang、TikTok**；未知 provider 会安全失败。

上游 Playwright MCP 包仅作为历史/背景对比，不是推荐的实际运行路径。

无凭据验证会构建 distribution bundle、完成 stdio handshake、启动真实的 humanized CloakBrowser session、检查状态并执行 teardown。各 provider 的真实站点 read/write 仍是需要凭据和授权的 live check；CI 不会伪造其成功。

## 引擎助手

运行时助手位于 `skills/hyper-cloaking/engine/` 下，是受支持的接口。

| 助手 | 用途 |
|---|---|
| `engine/cli.mjs` | `validate` / `smoke` / `live` 命令；运行隔离的实时验证。 |
| `engine/cookie.mjs` | 导入、归一化、检查、脱敏并注入 cookie（Chrome 导出 JSON、Playwright 数组、`cookie.yml` 站点/账户条目）。 |
| `engine/browser-utils.mjs` | 初始化 `~/.hyper-cloaking/`，以 `humanize: true` 启动 CloakBrowser，并提供 `humanMove` / `humanClick` / `humanType` / `humanScroll` / XPath 助手。 |

```bash
node skills/hyper-cloaking/engine/browser-utils.mjs init
node skills/hyper-cloaking/engine/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('claude-code'), null, 2))"
```

<details>
<summary><strong>Provider 与 Instagram 动作模块 —— 详情</strong></summary>

**Provider（仅元数据）。** `engine/cli.mjs live --provider <id>` **仅**选择元数据——为 `naver`、`instagram`、`youtube`、`x`、`coupang`、`tiktok` 或 `generic` 提供域名/来源以及 cookie/配置文件提示。Provider 绝不授权更广的来源，也不绕过安全、侦察或预检关卡；未知 provider 会安全失败（fail closed）。

**Instagram 动作模块。** 用于自动化**你自己的**已认证 Instagram 账户的可复用 JS 驱动流程位于 `engine/providers/instagram/` 下。它们需要真实的 Playwright `page`（非 Playwright-MCP 模式），并内置护栏：写操作默认为 dry-run，DM 回复仅针对已有对话（禁止冷启动外联），批量回复有上限、限速、需人工确认且可恢复。

```js
import { buildInstagramSession, instagramActions } from './engine/providers/instagram/index.mjs';
const session = buildInstagramSession(page, { stateDir: paths.stateDir, interactive: true });
const posts = await instagramActions.getUserPosts(session, 'nasa', { limit: 12 });
await instagramActions.likePost(session, 'https://www.instagram.com/p/ABC/', { dryRun: false });
```
</details>

## 运行时工作区

所有运行时状态都位于 `~/.hyper-cloaking/` 下（仅在沙箱测试时用 `HYPER_CLOAKING_HOME` 覆盖）：

```
~/.hyper-cloaking/
├── cookie.yml       # 站点/账户 cookie 条目（绝不提交）
├── profiles/        # 持久浏览器配置文件
├── downloads/       # 下载的文件
├── evidence/        # 报告和截图
├── logs/            # 运行日志
├── state/           # 限速窗口、可恢复状态
└── cache/cloakbrowser/   # 下载的隐身 Chromium 二进制文件
```

## 仓库结构

```
plugins/hyper-cloaking/skills/hyper-cloaking/ # 规范技能 (SKILL.md, engine, rules, references)
skills/hyper-cloaking/                # 规范技能的根目录镜像
.claude/skills/hyper-cloaking/  # Claude Code 技能镜像
.agents/skills/hyper-cloaking/  # AgentSkills 镜像
.claude-plugin/marketplace.json # Claude Code 市场清单
.agents/plugins/marketplace.json# Codex 市场清单
scripts/validate.mjs            # 结构 + 镜像一致性验证
```

各技能目录保持逐字节镜像。用 `npm run validate` 验证一致性和元数据。

## 开发

```bash
npm run validate      # 结构与镜像一致性检查
npm run lint          # 对 plugins、scripts 和 tests 运行 oxlint
npm run format        # prettier 格式化
npm test              # 根目录 E2E 与引擎单元测试
npm run ci            # 完整的本地 CI 检查
node skills/hyper-cloaking/engine/cli.mjs validate --json   # 引擎自检（无网络）
```

`npm test` 会运行根目录 E2E 套件（`tests/e2e/`）以及迁移至 `tests/unit/engine/` 的引擎单元测试（导入规范的 `plugins/hyper-cloaking/skills/hyper-cloaking/engine/` 源码）。`npm run validate` 会验证各技能镜像目录逐字节一致。
首次成功运行 GitHub Actions 后，确认必需的作业检查名称为 `quality` 和 `Node 20 compatibility`，再为 `main` 分支配置 Ruleset；本仓库不会自动应用该设置。

---

<div align="center">

**MIT © alpox** —— 基于 [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) + [Playwright MCP](https://github.com/microsoft/playwright-mcp)，仅限授权浏览。

</div>
