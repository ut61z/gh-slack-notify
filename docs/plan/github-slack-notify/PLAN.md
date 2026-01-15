# GitHub-Slack 通知システム実装計画

## プロジェクト概要

GitHubのPR、Issue、Workflowイベントを細かく制御してSlackに通知するシステム。既存のGitHub-Slack連携では通知が多すぎてノイズになっている問題を解決する。

### 主要機能
- PR Open時にSlack通知 → Merge/Close時に元のメッセージにスレッド返信
- ラベルベースのフィルタリング
- GitHub Project経由のIssue除外
- ベースブランチによるフィルタリング
- **定期的なサマリー機能**: 1日の終わりに通知を削除してサマリーにまとめる（チャンネルをスッキリ保つ）

---

## Decisions

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **実装方法** | GitHub Actions + Slack API | シンプルで無料枠で十分動く、GitHub内で完結 | - |
| **アクション形式** | JavaScript Action (`using: 'node20'`) | `@actions/artifact`が正常動作、環境変数が自動セット | Composite Actionから変更 |
| **通知イベント** | PR（Open/Close/Merge）<br>Issue（Open/Close）<br>Workflow（Success/Failure） | レビュー以外の重要イベントを網羅 | Reviewとコメントは除外 |
| **フィルタリング** | ラベルでフィルタ + Project経由のIssue除外 + ベースブランチフィルタ | 柔軟なフィルタリング | GraphQL APIでProject連携確認 |
| **スレッド返信機能** | PRがOpenされたら通知→Merge/Closeで元メッセージにreply | 1つのPRに関する通知を1スレッドにまとめる | - |
| **技術スタック** | TypeScript + Bun | 高速ビルド、モダンなランタイム | - |
| **ステート管理** | GitHub Artifacts + 暗号化 | 90日間保持、競合リスクなし、セキュア | リポジトリファイルから変更 |
| **暗号化** | AES-256-GCM | 強力な暗号化、認証付き暗号 | `encryption_key`入力で指定 |
| **通知先** | リポジトリごとに分ける | 複数リポジトリで使えるように | Workflowファイル内に設定 |
| **Workflow指定** | Workflow名で指定 | 直感的、わかりやすい | 入力パラメータで指定 |
| **メッセージフォーマット** | Block Kit | 視認性が高い | - |
| **設定管理** | Workflowファイル内に直接記述 | シンプル、一箇所で管理 | SecretsでSlackトークン管理 |
| **コメント通知** | 通知しない | ノイズ削減 | Issue/PRのコメントは対象外 |
| **エラーハンドリング** | Workflow実行を失敗させる | 問題を明確に把握 | - |

### 追加決定事項

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **Token種別** | GitHub Token (`secrets.GITHUB_TOKEN`) | シンプル、追加設定不要 | `actions: write`権限必要 |
| **State保存先** | GitHub Artifacts | 永続性（90日）、競合なし | `@actions/artifact`使用 |
| **削除ポリシー** | 完全削除 | チャンネルをスッキリ保つ | アーカイブ不要 |
| **ラベル設計** | ホワイトリスト/ブラックリスト両方対応 | リポジトリごとに柔軟に選択可能 | 入力パラメータで指定 |
| **ベースブランチフィルタ** | `base_branches`入力で指定 | 特定ブランチへのPRのみ通知可能 | `all`でフィルタなし |
| **Workflow通知** | Success/Failure両方通知（デフォルト） | 全体状況を把握可能 | `notify_on`でカスタマイズ可能 |
| **サマリーデフォルト時刻** | 23:00 JST（14:00 UTC） | 1日の終わりで集計 | cron式で指定 |
| **初回サマリー** | 全ての既存エントリを対象 | クリーンスタートできる | last_summary_atなし時 |
| **クロスリポジトリ通知** | 同じチャンネルもOK | リポジトリ名で区別可能 | メッセージにリポジトリ名を含める |
| **リポジトリ表示** | リポジトリ名のみ | 短くてスッキリ | owner/repo形式ではない |
| **デバッグモード** | `debug_mode=true`で暗号化無効化 | ローカル開発用 | 本番では必ず暗号化 |

### UI/UX決定事項

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **カラースキーム** | ステータス別に色分け | 視覚的に状態が分かりやすい | Open=緑、Merged/Closed=紫、Failure=赤、Success=緑 |
| **Workflow詳細** | 実行時間を表示 | パフォーマンス確認に便利 | 秒単位で表示 |
| **アクションボタン** | リンクのみ（ボタン不要） | シンプルに保つ | 操作はGitHub上で |

### テスト・運用決定事項

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **テスト環境** | 専用テストチャンネルを作る | 本番に影響しない実環境テスト | 実際のSlack APIで確認 |
| **クリーンアップ** | サマリー時に自動クリーンアップ | 削除済みエントリをstateから除去 | Artifact肥大化防止 |

### サマリー機能の決定事項

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **実行タイミング** | 毎日決まった時刻（カスタマイズ可能） | 予測可能、スケジュール管理しやすい | cron式で指定 |
| **メッセージ削除** | 全て削除してサマリーだけ残す | チャンネルがスッキリ、サマリーで把握 | reply先が見つからない場合は普通の投稿 |
| **サマリー内容** | PR一覧、Issue一覧（タイトルとリンク） | 簡潔で見やすい | Workflow実行結果は含めない |
| **対象期間** | 前回サマリーから今回まで | 漏れなく集計 | 前回実行時刻をstateに保存 |
| **実行順序** | サマリー作成→通知削除 | サマリー失敗時に元データが残る | 安全性重視 |
| **削除失敗時** | 失敗しても続行、ログ出力 | 一部失敗でもサマリーは作られる | - |

---

## 技術的な詳細

### アーキテクチャ

```
┌─────────────────────────────────────────┐
│   GitHub Events                         │
│   - pull_request (opened/closed)        │
│   - issues (opened/closed)              │
│   - workflow_run (completed)            │
│   - schedule (cron for summary)         │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   JavaScript Action (node20)            │
│   - イベント判定                         │
│   - フィルタリング処理                   │
│   - GraphQL API呼び出し                  │
│   - サマリー処理（scheduled）            │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   TypeScript/Bun アクション              │
│   - Slack通知処理                        │
│   - ステート管理（Artifact + 暗号化）    │
│   - Block Kit メッセージ生成            │
│   - サマリー作成・メッセージ削除         │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   Slack Web API                         │
│   - chat.postMessage                    │
│   - chat.postMessage (thread_ts指定)    │
│   - chat.delete                         │
└─────────────────────────────────────────┘
```

### ステート管理の仕組み

GitHub Artifactsに保存されるstate.jsonの構造（暗号化後）：

```json
{
  "last_summary_at": "2026-01-05T14:59:00Z",
  "pull_requests": {
    "123": "enc:base64iv:base64ciphertext:base64tag"
  },
  "issues": {
    "456": "enc:base64iv:base64ciphertext:base64tag"
  }
}
```

復号後のエントリ構造：

```json
{
  "channel": "C01234567",
  "message_ts": "1234567890.123456",
  "created_at": "2026-01-05T12:34:56Z",
  "event": "opened",
  "title": "feat: Add new feature",
  "url": "https://github.com/owner/repo/pull/123",
  "repo": "repo",
  "author": "username"
}
```

### 暗号化の仕組み

- **アルゴリズム**: AES-256-GCM（認証付き暗号）
- **IV**: 12バイトのランダム値（毎回生成）
- **認証タグ**: 16バイト
- **フォーマット**: `enc:<iv_base64>:<ciphertext_base64>:<tag_base64>`
- **キー**: 32バイト（256ビット）、base64エンコードで入力

### Artifact操作フロー

1. **読み込み**
   - octokit REST APIで最新のArtifactを検索
   - Artifactをダウンロード（zip形式）
   - zipを展開してstate.jsonを読み込み
   - 各エントリを復号

2. **保存**
   - 各エントリを暗号化
   - 一時ファイルにstate.jsonを書き込み
   - `@actions/artifact`の`uploadArtifact`でアップロード
   - 90日間保持

### GitHub GraphQL API でのProject判定

```graphql
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: 1) {
        totalCount
      }
    }
  }
}
```

- `totalCount > 0` → Project経由のIssue（除外）
- `totalCount = 0` → Project経由でない（通知対象）

### サマリー機能の仕組み

#### サマリー処理フロー

1. **データ収集**
   - Artifactからstateを読み込み
   - `last_summary_at`以降のエントリを取得
   - PR、Issue別に分類

2. **サマリーメッセージ作成**
   - Block Kitでリッチなメッセージを作成
   - PR一覧（Open/Merge/Close）
   - Issue一覧（Open/Close）
   - 各項目にタイトルとリンクを含める

3. **Slackに投稿**
   - `chat.postMessage`でサマリーを投稿

4. **既存メッセージの削除**
   - stateに保存されている各メッセージのtsを使用
   - `chat.delete`で削除
   - 削除失敗してもログ出力して続行

5. **stateのクリーンアップ**
   - 削除済みエントリをクリア
   - `last_summary_at`を現在時刻に更新
   - Artifactに保存

---

## 実装状況

### 完了済み

- [x] リポジトリ作成（`gh-slack-notify`）
- [x] TypeScript + Bun環境の構築
- [x] 依存関係のインストール
  - `@slack/web-api`
  - `@actions/core`
  - `@actions/github`
  - `@actions/artifact`
  - `adm-zip`
- [x] プロジェクト構成
  ```
  src/
    index.ts    - Main entry point
    slack.ts    - Slack API client & Block Kit messages
    state.ts    - State management (Artifact + 暗号化)
    github.ts   - GitHub GraphQL API
    summary.ts  - Daily summary feature
    crypto.ts   - 暗号化/復号処理
    types.ts    - 型定義
  dist/
    index.js    - Bundled output (committed)
  action.yml    - JavaScript Action definition
  ```
- [x] Slack通知コアロジックの実装
  - [x] Slack Web APIクライアントの初期化
  - [x] Block Kit形式のメッセージフォーマット作成
  - [x] `chat.postMessage` での通知送信
  - [x] スレッド返信機能（`thread_ts`指定）
- [x] ステート管理機能の実装
  - [x] GitHub Artifactの読み込み/書き込み
  - [x] AES-256-GCM暗号化
  - [x] PR番号/Issue番号とSlack message tsのマッピング管理
- [x] GitHub GraphQL API統合
  - [x] IssueがProjectに紐づいているかの判定クエリ
  - [x] Project経由のIssueをフィルタする処理
- [x] JavaScript Action（action.yml）の作成
  - [x] 入力パラメータの定義
    - `event_type`: イベントタイプ
    - `slack_token`: Slack Bot Token
    - `slack_channel`: SlackチャンネルID
    - `github_token`: GitHub Token
    - `label_filter_mode`: フィルタモード
    - `filter_labels`: フィルタするラベル
    - `exclude_project_issues`: Project経由のIssue除外
    - `workflow_names`: 通知対象のWorkflow名
    - `notify_on`: 通知タイミング
    - `base_branches`: ベースブランチフィルタ
    - `encryption_key`: 暗号化キー
    - `debug_mode`: デバッグモード
- [x] サマリー機能の実装
  - [x] サマリー処理ロジック
  - [x] メッセージ削除機能
  - [x] reply先チェック機能
- [x] テスト
  - [x] ユニットテスト（Slack、State、GitHub、Crypto）

### 進行中

- [ ] CI/CDでの動作確認（Artifact関連のバグ修正中）

### 未着手

- [ ] ドキュメント整備
  - [ ] README.mdの拡充
  - [ ] トラブルシューティングガイド

---

## 使用例

### 呼び出し側のリポジトリでの設定

`.github/workflows/slack-notifications.yml`:

```yaml
name: Slack Notifications

on:
  pull_request:
    types: [opened, closed]
  issues:
    types: [opened, closed]

permissions:
  contents: write
  actions: write

jobs:
  notify-pr:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@main
        with:
          event_type: pull_request
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          encryption_key: ${{ secrets.SLACK_NOTIFY_ENCRYPTION_KEY }}

  notify-issue:
    if: github.event_name == 'issues'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@main
        with:
          event_type: issues
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          exclude_project_issues: 'true'
          encryption_key: ${{ secrets.SLACK_NOTIFY_ENCRYPTION_KEY }}
```

### サマリー機能の設定

`.github/workflows/slack-summary.yml`:

```yaml
name: Slack Daily Summary

on:
  schedule:
    # 毎日 23:00 JST (14:00 UTC) に実行
    - cron: '0 14 * * 1-5'
  workflow_dispatch:

permissions:
  contents: write
  actions: write

jobs:
  daily-summary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@main
        with:
          event_type: summary
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          encryption_key: ${{ secrets.SLACK_NOTIFY_ENCRYPTION_KEY }}
```

---

## 参考情報

### 必要なSlack権限

Slack Appに以下の権限が必要：
- `chat:write` - メッセージ送信
- `chat:write.public` - 公開チャンネルへの投稿
- `chat:delete` - メッセージ削除（サマリー機能使用時）

### 必要なGitHub権限

Workflowに以下の権限が必要：
- `contents: write` - チェックアウト用
- `actions: write` - Artifactのアップロード/ダウンロード用

### 暗号化キーの生成

```bash
# 32バイトのランダムキーを生成してbase64エンコード
openssl rand -base64 32
```

生成されたキーを`SLACK_NOTIFY_ENCRYPTION_KEY`シークレットに設定。

### 外部リソース

- [Slack Block Kit Builder](https://api.slack.com/block-kit/building)
- [GitHub GraphQL API Explorer](https://docs.github.com/en/graphql/overview/explorer)
- [GitHub Actions Artifacts](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts)

---

## リスクと制約事項

### リスク

1. **Artifact保持期限**
   - デフォルト90日間保持（設定可能）
   - 期限切れ時はstateがリセットされる
   - **緩和策**: 定期的なサマリーでstateをクリーンに保つ

2. **Slack API制限**
   - レート制限に引っかかる可能性
   - **緩和策**: エラーハンドリングとリトライ

3. **サマリー実行中の新しい通知**
   - サマリー作成中に新しいイベントが発生した場合、タイミング次第で削除される可能性
   - **緩和策**: サマリー実行時刻を営業時間外に設定

4. **メッセージ削除失敗**
   - Slack APIの制限や権限エラーで削除失敗の可能性
   - **緩和策**: 失敗してもログ出力して続行、手動削除で対応

### 制約事項

1. **コメント通知は対象外**
   - Issue/PRのコメントは通知しない
   - ノイズ削減のための意図的な制約

2. **Review通知は対象外**
   - PR Reviewは通知しない
   - 必要であれば将来的に追加可能

---

## 今後の拡張案

- [ ] コメント通知のオプション追加
- [ ] Review通知のオプション追加
- [ ] 複数Slackワークスペース対応
- [ ] Discord、Teams等の他の通知サービス対応
- [ ] サマリーに統計情報を追加（PR/Issueの件数、成功率等）
- [ ] Workflow実行結果をサマリーに含める（オプション）
- [ ] サマリーの頻度をカスタマイズ（毎日、毎週等）
