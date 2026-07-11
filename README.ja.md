[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md) | 日本語 | [Español](README.es.md)

<div align="center">

# Hyper Cloaking

**どんなブラウザ作業でも、エージェントが最後までやり切る。テスト権限さえあれば、Hyper Cloaking が仕上げます。**

AI エージェントのための、人間のペースで動くステルスブラウザ。[Playwright MCP](https://github.com/microsoft/playwright-mcp) の背後で [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) を駆動します。手動セットアップも、「ページは開きました」式の中途半端な結果もなし——証拠をもって完了します。

<p>
  <img src="https://img.shields.io/badge/Claude_Code-D97757?logo=claude&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/Codex-000000?logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Cursor-6E56CF" alt="Cursor">
  <img src="https://img.shields.io/badge/OpenClaw-1F6FEB" alt="OpenClaw">
  <img src="https://img.shields.io/badge/Hermes-8957E5" alt="Hermes">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A5_20-3FB950?logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/authorized_use-only-F0B72F" alt="認可された用途のみ">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

</div>

---

## ⚡ インストール

**Claude Code** — このリポジトリをプラグインマーケットプレイスとして追加し、プラグインをインストールします。

```bash
/plugin marketplace add alpox/hyper-cloaking
/plugin install hyper-cloaking
```

**Codex** はミラーされたマニフェスト `.agents/plugins/marketplace.json` を読み込みます —— Codex のプラグイン画面からマーケットプレイスを追加し、`hyper-cloaking` を有効化してください。

**AgentSkills 互換クライアント**（Cursor、OpenClaw、Hermes など）—— `skills` CLI でインストールするか、`skills/hyper-cloaking/` をクライアントが読み込むスキルルートにコピーします。

```bash
npx skills add . --list   # ソースが提供する内容を確認
npx skills add .          # 現在のプロジェクトにインストール
```

**Node.js ≥ 20** と、`cloakbrowser`・`playwright-core` を取得するためのネットワークアクセスが必要です。残りは初回実行時にスキルがインストール・修復します。

## 💬 試してみる

覚えるコマンドはありません。普段どおりエージェントに頼むだけ——ブラウザ作業を指せば、スキルが起動します。

> *「CloakBrowser で私の商品ページがモバイルで正しく表示されるか確認してスクリーンショットを撮って。」*
> *「保存したクッキーで自分の Instagram にログインして、直近の投稿を 12 件取得して。」*
> *「私が運用しているこのダッシュボードを監視して、デプロイ状態が失敗に変わったら知らせて。」*

**期待される動作：** エージェントはセットアップの質問をいくつか行い、人間のペースのステルスブラウザを起動して作業を実行し、**証拠がある時だけ**完了します——スクリーンショット、抽出したテキスト、確認済みの状態変化が `~/.hyper-cloaking/evidence/` 以下に保存されます。

## 🌐 対応環境

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** —— `SKILL.md` を読み込む MCP 対応エージェントなら何でも。**Naver · Reddit · Instagram · YouTube · X** 向けのメタデータヒントを内蔵し、テスト権限のある任意のサイトには `generic` モードを提供します。

## ⚙️ なぜ通用するのか

- **改造した User-Agent ではなく、本物のステルスブラウザ** —— ヘッダーを差し替えるだけでなく、本物のブラウザフィンガープリントを持つ CloakBrowser の Chromium を Playwright MCP の背後で駆動します。
- **デフォルトで人間のペース** —— すべての実作業実行で `humanize: true` を強制します：人間のペースのマウス移動・タイピング・スクロールにより、長い自動化フローが途中で止まったり壊れたりしません。
- **起動前にゲートを通過** —— ターゲットの安全分類、認可根拠、許可オリジン、そしてプリフライト質問の一巡は、ブラウザが開く*前*に行われます。
- **証拠がなければ完了ではない** —— ページの読み込みは決して「完了」ではありません。結果が証明された時だけ作業が終わり、構造化された結果を返します。
- **手間いらずのセットアップ** —— Node.js、`cloakbrowser`、`playwright-core`、Playwright MCP を確認し、欠けているものはインストール・修復します。

## 🆚 通常の MCP ブラウザ vs `+ Hyper Cloaking`

| こういう時に… | 通常の MCP ブラウザ | `+ Hyper Cloaking` |
| :--- | :--- | :--- |
| **自分の**ログイン済みアカウントを自動化 | ✖ 自動化フィンガープリントに引っかかる | ✓ 人間ペース + 安全なクッキー読み込み |
| 作業が認可済みかを先に確認 | ✖ ゲートなし | ✓ 起動前の安全・プリフライトゲート |
| サイトのクッキーを漏らさず再利用 | ✖ 手動・生の値 | ✓ 正規化・マスキング、コミットしない |
| 「完了」を本当の完了と信頼 | ✖ ページ読み込み＝成功 | ✓ 証拠で検証された結果 |
| ステルスブラウザを動かす | ✖ 手動インストール・配線 | ✓ 自動インストール/修復 + MCP 設定 |
| **ログイン・CAPTCHA・不正検知の回避** | ✖ | ✖ **設計上、拒否**（境界を参照） |

通常のブラウザにできないのは一番上の行です：**本当に許可された作業で、人間のように振る舞うこと。**

## 🔁 仕組み

*「このサイトに CloakBrowser を使って」* のようなリクエストは、境界の明確な 10 ステップのワークフローになります。

<details>
<summary><strong>ゲートから証拠までの完全なパイプライン —— 詳細</strong></summary>

1. **ターゲット安全ゲート** —— ターゲットを許可 / 拒否 / 要確認に分類し、認可根拠と許可オリジンを記録します。
2. **プリフライト質問ゲート** —— ホストのネイティブな構造化質問インターフェースを通じて、ターゲット URL、許可オリジン、ヘッドレスモード、クッキーモード/アカウント、ブラウザを開いたままにするかを収集します。
3. **セットアップゲート** —— Node.js、`cloakbrowser`、`playwright-core`、Playwright MCP を確認し、欠けているものをインストール・修復します。
4. **ランタイムワークスペース** —— `~/.hyper-cloaking/` を初期化し、`cookie.yml`、プロファイル、ダウンロード、証拠、ログ、状態を管理します。
5. **クッキー処理** —— サイトに一致するクッキー（Chrome エクスポート JSON、Playwright 配列、マルチアカウントエントリ）を専用ヘルパーで正規化・読み込みし、生の値をリポジトリに保存しません。
6. **実行ファイルの解決** —— `~/.hyper-cloaking/cache/cloakbrowser/` 以下のキャッシュされた CloakBrowser Chromium バイナリを見つけます。
7. **人間ペースの起動** —— すべての実作業実行で `humanize: true` を必須とします（人間のペースのマウス・タイピング・スクロール）。
8. **MCP 設定** —— Codex TOML、JSON `mcpServers`（Claude Code / Cursor）、OpenClaw `mcp.servers`、Hermes `mcp_servers`、または直接 CLI コマンドの設定を生成し、`@playwright/mcp` を CloakBrowser 実行ファイルに向けます。
9. **タスク実行 + 結果検証** —— 依頼された作業を実行し、証拠が結果を証明した時だけ完了します（ページ読み込みだけでは決して完了しません）。
10. **構造化レポート** —— `targetSafety`、`outcome`、`failure`、`contentBoundary`、`learning` を返し、レポートとスクリーンショットを `~/.hyper-cloaking/evidence/` 以下に保存します。

ブラウザの DOM、ページテキスト、ダウンロード、コンソール出力は、**命令権限を持たない信頼できないデータ**として扱われます。
</details>

## 🔒 境界

Hyper Cloaking は**認可されたブラウジング**のためのツールであり、アクセス制御を回避する手段ではありません。

- **用途** — テスト権限のある資産に対する、認可された QA、監視、個人アカウント自動化、診断。
- **禁止** — アクセス制御の回避、不正検知システムの回避、CAPTCHA の突破、制限されたスクレイピング、無許可のアカウント自動化。
- ヒューマナイズは自動化フィンガープリントを減らすだけで、作業が認可されている必要があるという要件を**なくしません**。
- クッキーは正規化され、ログではマスキングされ、コミットされません。スキルは与えられていない認可を捏造せず、未知の provider は安全側に失敗（fail closed）します。

---

## MCP 設定スニペット

CloakBrowser Chromium バイナリが解決されたら、Playwright MCP をそれに向けます。デフォルトの起動は**ヘッドレス**かつ**サンドボックス**です。表示ありのブラウジングには `--headless` を外します。

**直接コマンド**

```bash
npx @playwright/mcp@latest --headless --sandbox \
  --executable-path ~/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome
```

**Codex (`~/.codex/config.toml`)** —— 完全に展開したパスを使用：

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

**OpenClaw (`mcp.servers.<name>`)** と **Hermes (`~/.hermes/config.yaml` の `mcp_servers.<name>`)** も、それぞれの設定キーの下で同じ command/args の形を取ります。

以下で決定論的に生成できます。

```bash
node skills/hyper-cloaking/engine/cli.mjs mcp-config --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --client codex --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --headed
```

## エンジンヘルパー

ランタイムヘルパーは `skills/hyper-cloaking/engine/` 以下にあり、サポートされたインターフェースです。

| ヘルパー | 用途 |
|---|---|
| `engine/cli.mjs` | `validate` / `smoke` / `mcp-config` / `live` コマンド。MCP 設定のレンダリングと隔離されたライブ検証の実行。 |
| `engine/cookie.mjs` | クッキーのインポート・正規化・検査・マスキング・注入（Chrome エクスポート JSON、Playwright 配列、`cookie.yml` サイト/アカウントエントリ）。 |
| `engine/browser-utils.mjs` | `~/.hyper-cloaking/` の初期化、`humanize: true` での CloakBrowser 起動、`humanMove` / `humanClick` / `humanType` / `humanScroll` / XPath ヘルパーの提供。 |

```bash
node skills/hyper-cloaking/engine/browser-utils.mjs init
node skills/hyper-cloaking/engine/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --help
```

<details>
<summary><strong>Provider と Instagram アクションモジュール —— 詳細</strong></summary>

**Provider（メタデータのみ）。** `engine/cli.mjs live --provider <id>` は**メタデータのみ**を選択します —— `naver`、`reddit`、`instagram`、`youtube`、`x`、`generic` に対するドメイン/オリジンおよびクッキー/プロファイルのヒントです。Provider はより広いオリジンを認可したり、安全・偵察・プリフライトのゲートを回避したりせず、未知の provider は安全側に失敗（fail closed）します。

**Instagram アクションモジュール。** **自分の**認証済み Instagram アカウントを自動化する再利用可能な JS ドライバフローが `engine/providers/instagram/` 以下にあります。実際の Playwright `page` が必要で（Playwright-MCP モード不可）、ガードレールを内蔵しています：書き込みはデフォルトで dry-run、DM 返信は既存の会話のみ対象（コールドアウトリーチ禁止）、一括返信は上限・レート制限・人間の確認あり・再開可能です。

```js
import { buildInstagramSession, instagramActions } from './engine/providers/instagram/index.mjs';
const session = buildInstagramSession(page, { stateDir: paths.stateDir, interactive: true });
const posts = await instagramActions.getUserPosts(session, 'nasa', { limit: 12 });
await instagramActions.likePost(session, 'https://www.instagram.com/p/ABC/', { dryRun: false });
```
</details>

## ランタイムワークスペース

すべてのランタイム状態は `~/.hyper-cloaking/` 以下にあります（サンドボックステスト時のみ `HYPER_CLOAKING_HOME` で上書き）：

```
~/.hyper-cloaking/
├── cookie.yml       # サイト/アカウントのクッキーエントリ（コミットしない）
├── profiles/        # 永続ブラウザプロファイル
├── downloads/       # ダウンロードしたファイル
├── evidence/        # レポートとスクリーンショット
├── logs/            # 実行ログ
├── state/           # レート制限ウィンドウ、再開可能な状態
└── cache/cloakbrowser/   # ダウンロードしたステルス Chromium バイナリ
```

## リポジトリ構成

```
skills/hyper-cloaking/          # 正規スキル (SKILL.md, engine, rules, references)
plugins/hyper-cloaking/         # マーケットプレイス用のプラグインパッケージのコピー
.claude/skills/hyper-cloaking/  # Claude Code スキルミラー
.agents/skills/hyper-cloaking/  # AgentSkills ミラー
.claude-plugin/marketplace.json # Claude Code マーケットプレイスマニフェスト
.agents/plugins/marketplace.json# Codex マーケットプレイスマニフェスト
scripts/validate.mjs            # 構造 + ミラー一致検証
```

スキルディレクトリはバイト単位でミラーされます。一致とメタデータは `npm run validate` で検証します。

## 開発

```bash
npm run validate      # 構造とミラー一致のチェック
npm run lint          # plugins・scripts に対する oxlint
npm run format        # prettier フォーマット
npm test              # ルート E2E と正規エンジンのテスト
npm run ci            # ローカル CI ゲート一式
node skills/hyper-cloaking/engine/cli.mjs validate --json   # エンジンの自己チェック（ネットワークなし）
```

`npm test` はルート E2E スイートと正規の `skills/hyper-cloaking/engine` テストを実行します。`npm run validate` はミラーされたスキルディレクトリがバイト単位で一致することを検証します。
GitHub Actions の初回成功後、必須ジョブチェック名が `quality` と `Node 20 compatibility` であることを確認してから `main` ブランチの Ruleset を設定します。このリポジトリはその設定を自動適用しません。

---

<div align="center">

**MIT © alpox** —— [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) + [Playwright MCP](https://github.com/microsoft/playwright-mcp) をベースに、認可されたブラウジング専用。

</div>
