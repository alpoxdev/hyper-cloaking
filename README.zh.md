[English](README.md) | [한국어](README.ko.md) | 中文 | [日本語](README.ja.md) | [Español](README.es.md)

<div align="center">

# Hyper Cloaking

**无论什么浏览器任务，你的智能体都能完成。只要你有授权，Hyper Cloaking 就能搞定。**

一个为 AI 智能体打造的、以人类节奏运行的隐身浏览器，在 [Playwright MCP](https://github.com/microsoft/playwright-mcp) 背后驱动 [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)。无需手动配置，没有"页面加载完了"式的半成品结果——它以证据收尾。

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

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** —— 任何加载 `SKILL.md` 的 MCP 兼容智能体。内置针对 **Naver · Reddit · Instagram · YouTube · X** 的元数据提示，并为任何你有权测试的站点提供 `generic` 模式。

## ⚙️ 为什么行得通

- **真正的隐身浏览器，而非改过的 User-Agent** —— 它在 Playwright MCP 背后驱动 CloakBrowser 的 Chromium，带有真实的浏览器指纹，而不只是替换一个请求头。
- **默认以人类节奏运行** —— 每次实际运行都强制 `humanize: true`：以人类节奏的鼠标移动、打字和滚动，让长时间的自动化流程不会中途卡住或中断。
- **启动前先过关卡** —— 目标安全分类、授权依据、允许来源以及一轮预检问答，都在浏览器打开*之前*完成。
- **没有证据就不算完成** —— 页面加载永远不等于"完成"。只有结果得到证明时任务才结束，并返回结构化结果。
- **省心的配置** —— 它会检查 Node.js、`cloakbrowser`、`playwright-core` 和 Playwright MCP，然后安装或修复任何缺失的部分。

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
3. **配置关卡** —— 检查 Node.js、`cloakbrowser`、`playwright-core` 和 Playwright MCP；安装或修复任何缺失项。
4. **运行时工作区** —— 初始化 `~/.hyper-cloaking/`，用于 `cookie.yml`、配置文件、下载、证据、日志和状态。
5. **Cookie 处理** —— 通过专用助手归一化并加载与站点匹配的 cookie（Chrome 导出 JSON、Playwright 数组、多账户条目），绝不在仓库中存储原始值。
6. **可执行文件解析** —— 在 `~/.hyper-cloaking/cache/cloakbrowser/` 下定位缓存的 CloakBrowser Chromium 二进制文件。
7. **人类节奏启动** —— 每次实际运行都强制 `humanize: true`（以人类节奏的鼠标、打字、滚动）。
8. **MCP 配置** —— 生成用于 Codex TOML、JSON `mcpServers`（Claude Code / Cursor）、OpenClaw `mcp.servers`、Hermes `mcp_servers` 或直接 CLI 命令的配置，让 `@playwright/mcp` 指向 CloakBrowser 可执行文件。
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

## MCP 配置片段

CloakBrowser Chromium 二进制文件解析完成后，让 Playwright MCP 指向它。默认启动为**无头**且**沙箱**；去掉 `--headless` 即可可视化浏览。

**直接命令**

```bash
npx @playwright/mcp@latest --headless --sandbox \
  --executable-path ~/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome
```

**Codex (`~/.codex/config.toml`)** —— 使用完全展开的路径：

```toml
[mcp_servers.hyper-cloaking]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--sandbox", "--executable-path", "/Users/you/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome"]
```

**Claude Code / Cursor (`mcpServers` JSON)**

```json
{
  "mcpServers": {
    "hyper-cloaking": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless", "--sandbox", "--executable-path", "/Users/you/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome"]
    }
  }
}
```

**OpenClaw (`mcp.servers.<name>`)** 和 **Hermes (`~/.hermes/config.yaml` 中的 `mcp_servers.<name>`)** 在各自的配置键下遵循相同的 command/args 结构。

可以确定性地生成以上任意一种：

```bash
node skills/hyper-cloaking/engine/cli.mjs mcp-config --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --client codex --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --headed
```

## 引擎助手

运行时助手位于 `skills/hyper-cloaking/engine/` 下，是受支持的接口。

| 助手 | 用途 |
|---|---|
| `engine/cli.mjs` | `validate` / `smoke` / `mcp-config` / `live` 命令；渲染 MCP 配置并运行隔离的实时验证。 |
| `engine/cookie.mjs` | 导入、归一化、检查、脱敏并注入 cookie（Chrome 导出 JSON、Playwright 数组、`cookie.yml` 站点/账户条目）。 |
| `engine/browser-utils.mjs` | 初始化 `~/.hyper-cloaking/`，以 `humanize: true` 启动 CloakBrowser，并提供 `humanMove` / `humanClick` / `humanType` / `humanScroll` / XPath 助手。 |

```bash
node skills/hyper-cloaking/engine/browser-utils.mjs init
node skills/hyper-cloaking/engine/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --help
```

<details>
<summary><strong>Provider 与 Instagram 动作模块 —— 详情</strong></summary>

**Provider（仅元数据）。** `engine/cli.mjs live --provider <id>` **仅**选择元数据——为 `naver`、`reddit`、`instagram`、`youtube`、`x` 或 `generic` 提供域名/来源以及 cookie/配置文件提示。Provider 绝不授权更广的来源，也不绕过安全、侦察或预检关卡；未知 provider 会安全失败（fail closed）。

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
