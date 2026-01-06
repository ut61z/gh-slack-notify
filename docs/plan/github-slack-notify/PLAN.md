# GitHub-Slack 通知システム実装計画

## プロジェクト概要

GitHubのPR、Issue、Workflowイベントを細かく制御してSlackに通知するシステム。既存のGitHub-Slack連携では通知が多すぎてノイズになっている問題を解決する。

### 主要機能
- PR Open時にSlack通知 → Merge/Close時に元のメッセージにスレッド返信
- ラベルベースのフィルタリング
- GitHub Project経由のIssue除外
- 複数リポジトリで使えるReusable Workflow
- **定期的なサマリー機能**: 1日の終わりに通知を削除してサマリーにまとめる（チャンネルをスッキリ保つ）

---

## Decisions

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **実装方法** | GitHub Actions + Slack API | シンプルで無料枠で十分動く、GitHub内で完結 | - |
| **通知イベント** | PR（Open/Close/Merge）<br>Issue（Open/Close）<br>Workflow（Success/Failure） | レビュー以外の重要イベントを網羅 | Reviewとコメントは除外 |
| **フィルタリング** | ラベルでフィルタ + Project経由のIssue除外 | バグや議論のためのIssueだけを通知 | GraphQL APIでProject連携確認 |
| **スレッド返信機能** | PRがOpenされたら通知→Merge/Closeで元メッセージにreply | 1つのPRに関する通知を1スレッドにまとめる | メッセージtsを`.github/slack-notifications.json`に保存 |
| **技術スタック** | TypeScript/Node.js | GitHub Actionsと相性良い、エコシステム豊富 | - |
| **ステート管理** | リポジトリファイル<br>（`.github/slack-notifications.json`） | 永続化、無料、読み書き容易 | 競合はリトライ機構で処理 |
| **通知先** | リポジトリごとに分ける | 複数リポジトリで使えるように | Workflowファイル内に設定 |
| **Workflow指定** | Workflow名で指定 | 直感的、わかりやすい | 入力パラメータで指定 |
| **メッセージフォーマット** | ハイブリッド<br>（基本Block Kit、一部Text） | 視認性とメンテナンス性のバランス | - |
| **設定管理** | Workflowファイル内に直接記述 | シンプル、一箇所で管理 | SecretsでSlackトークン管理 |
| **コメント通知** | 通知しない | ノイズ削減 | Issue/PRのコメントは対象外 |
| **エラーハンドリング** | Workflow実行を失敗させる | 問題を明確に把握 | - |
| **プロジェクト構成** | 新規リポジトリ作成 + Reusable Workflow | 複数リポジトリで汎用的に使える | - |

### 追加決定事項（2026-01-06 インタビュー）

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **Token種別** | GitHub App Token | 細かい権限制御が可能で組織向き | Organizationで作成・管理 |
| **State保存先** | 各リポジトリに個別保存 | シンプルで競合リスク低い | クロスリポジトリサマリーは非対応 |
| **削除ポリシー** | 完全削除 | チャンネルをスッキリ保つ | アーカイブ不要 |
| **GitHub App管理** | Organizationで作成 | チームで共有可能、組織管理しやすい | 管理者権限必要 |
| **ラベル設計** | ホワイトリスト/ブラックリスト両方対応 | リポジトリごとに柔軟に選択可能 | 入力パラメータで指定 |
| **Workflow通知** | Success/Failure両方通知（デフォルト） | 全体状況を把握可能 | カスタマイズも検討 |
| **サマリーデフォルト時刻** | 23:59 JST（14:59 UTC） | 完全に1日の終わりで集計 | カスタマイズ可能 |
| **初回サマリー** | 全ての既存エントリを対象 | クリーンスタートできる | last_summary_atなし時 |
| **クロスリポジトリ通知** | 同じチャンネルもOK | リポジトリ名で区別可能 | メッセージにリポジトリ名を含める |
| **リポジトリ表示** | リポジトリ名のみ | 短くてスッキリ | owner/repo形式ではない |
| **ユーザー情報表示** | アイコン・アバター表示する | 誰がPR作ったか一目で分かる | Block Kitで実装 |
| **リトライ失敗時** | 通知は送る（ステート失われるのは許容） | 通知自体は届くことを優先 | ログで警告出力 |

### UI/UX決定事項

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **カラースキーム** | ステータス別に色分け | 視覚的に状態が分かりやすい | Open=青、Merged=緑、Closed=赤、Failure=赤、Success=緑 |
| **Workflow詳細** | 実行時間を表示 | パフォーマンス確認に便利 | 秒単位で表示 |
| **アクションボタン** | リンクのみ（ボタン不要） | シンプルに保つ | 操作はGitHub上で |

### テスト・運用決定事項

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **テスト環境** | 専用テストチャンネルを作る | 本番に影響しない実環境テスト | 実際のSlack APIで確認 |
| **クリーンアップ** | サマリー時に自動クリーンアップ | 削除済みエントリをstateから除去 | ファイル肥大化防止 |

### サマリー機能の決定事項

| Item | Choice | Reason | Notes |
|------|--------|--------|-------|
| **実行タイミング** | 毎日決まった時刻（カスタマイズ可能） | 予測可能、スケジュール管理しやすい | cron式で指定、入力パラメータで設定 |
| **メッセージ削除** | 全て削除してサマリーだけ残す | チャンネルがスッキリ、サマリーで把握 | reply先が見つからない場合は普通の投稿 |
| **サマリー内容** | PR一覧、Issue一覧（タイトルとリンク） | 簡潔で見やすい | Workflow実行結果は含めない |
| **対象期間** | 前回サマリーから今回まで | 漏れなく集計 | 前回実行時刻をstateに保存 |
| **実行順序** | サマリー作成→通知削除 | サマリー失敗時に元データが残る | 安全性重視 |
| **削除対象の特定** | stateファイルにts保存 | 確実に特定可能 | `.github/slack-notifications.json`に保存 |
| **削除失敗時** | 失敗しても続行、ログ出力 | 一部失敗でもサマリーは作られる | - |
| **メッセージ詳細度** | 簡潔な一覧（タイトルとリンクのみ） | コンパクト、見やすい | 詳細はリンク先で確認 |
| **state管理** | 削除済みメッセージをクリア+実行時刻保存 | ファイルサイズ管理、次回期間特定 | - |
| **実行時刻** | カスタマイズ可能 | チームに合わせられる | 入力パラメータで指定 |
| **フォーマット** | Block Kitでリッチな表現 | 視認性が高い | - |

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
│   Reusable Workflow                     │
│   - イベント判定                         │
│   - フィルタリング処理                   │
│   - GraphQL API呼び出し                  │
│   - サマリー処理（scheduled）            │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   TypeScript/Node.js アクション         │
│   - Slack通知処理                        │
│   - ステート管理（JSON読み書き）         │
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

`.github/slack-notifications.json` の構造：

```json
{
  "last_summary_at": "2026-01-05T14:59:00Z",
  "pull_requests": {
    "123": {
      "channel": "C01234567",
      "message_ts": "1234567890.123456",
      "created_at": "2026-01-05T12:34:56Z",
      "event": "opened",
      "title": "feat: Add new feature",
      "url": "https://github.com/owner/repo/pull/123",
      "repo": "repo",
      "author": {
        "login": "username",
        "avatar_url": "https://avatars.githubusercontent.com/u/123456"
      }
    }
  },
  "issues": {
    "456": {
      "channel": "C01234567",
      "message_ts": "1234567890.654321",
      "created_at": "2026-01-05T13:00:00Z",
      "event": "opened",
      "title": "Bug: Fix issue",
      "url": "https://github.com/owner/repo/issues/456",
      "repo": "repo",
      "author": {
        "login": "username",
        "avatar_url": "https://avatars.githubusercontent.com/u/123456"
      }
    }
  }
}
```

### リトライ機構のフロー

1. `git pull origin main`
2. JSONファイルを読み込み
3. 新しいメッセージ情報を追加/更新
4. JSONファイルに書き込み
5. `git add .github/slack-notifications.json`
6. `git commit -m "chore: Slack通知ステート更新"`
7. `git push origin main`
8. プッシュ失敗 → 1に戻る（最大3回リトライ）

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
   - stateファイルを読み込み
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
   - stateファイルに保存されている各メッセージのtsを使用
   - `chat.delete`で削除
   - 削除失敗してもログ出力して続行

5. **stateファイルのクリーンアップ**
   - 削除済みエントリをクリア
   - `last_summary_at`を現在時刻に更新
   - stateファイルを保存（git commit & push）

#### reply先が見つからない場合の処理

PR Merge/Close時に、元のOpen通知が既に削除されている場合：
- stateファイルで元のメッセージtsを確認
- 存在しない場合は、`thread_ts`なしで普通のメッセージとして投稿
- これにより、サマリー実行後でも情報が失われない

#### サマリーメッセージのBlock Kit例

```json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "📊 Daily Summary - 2026-01-05"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Pull Requests*"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "✅ *Merged*\n• <https://github.com/owner/repo/pull/123|#123: feat: Add new feature>\n\n🚀 *Opened*\n• <https://github.com/owner/repo/pull/124|#124: fix: Bug fix>"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Issues*"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "🐛 *Opened*\n• <https://github.com/owner/repo/issues/456|#456: Bug: Fix issue>"
      }
    }
  ]
}
```

---

## Next Steps

### 1. 新規リポジトリのセットアップ

- [ ] リポジトリ作成（例: `github-slack-notifications`）
- [ ] TypeScript + Node.js環境の構築
  - `package.json` 作成
  - TypeScript設定（`tsconfig.json`）
  - 依存関係のインストール：
    - `@slack/web-api`
    - `@actions/core`
    - `@actions/github`
    - `@octokit/graphql`
- [ ] Reusable Workflow用のディレクトリ構成
  ```
  .github/
    workflows/
      notify-pr.yml
      notify-issue.yml
      notify-workflow.yml
      notify-summary.yml
  src/
    index.ts
    slack.ts
    state.ts
    github.ts
    summary.ts
  dist/
    index.js (ビルド後)
  ```

### 2. Slack通知コアロジックの実装

- [ ] Slack Web APIクライアントの初期化
- [ ] Block Kit形式のメッセージフォーマット作成
  - PR Open時のメッセージテンプレート
  - PR Close/Merge時のメッセージテンプレート
  - Issue Open/Close時のメッセージテンプレート
  - Workflow Success/Failure時のメッセージテンプレート
- [ ] `chat.postMessage` での通知送信
- [ ] スレッド返信機能（`thread_ts`指定）

### 3. ステート管理機能の実装

- [ ] `.github/slack-notifications.json`の読み込み処理
- [ ] JSONへの書き込み処理
- [ ] git操作（pull → commit → push）
- [ ] リトライ機構の実装（最大3回）
- [ ] PR番号/Issue番号とSlack message tsのマッピング管理
- [ ] 古いエントリのクリーンアップ（オプション：30日以上前のものを削除等）

### 4. GitHub GraphQL API統合

- [ ] GraphQLクライアントのセットアップ
- [ ] IssueがProjectに紐づいているかの判定クエリ
- [ ] Project経由のIssueをフィルタする処理
- [ ] エラーハンドリング（API制限等）

### 5. Reusable Workflowの作成

#### PR用Workflow（`notify-pr.yml`）

```yaml
name: Notify PR Events

on:
  workflow_call:
    inputs:
      slack_channel:
        required: true
        type: string
      filter_labels:
        required: false
        type: string
        default: ""
    secrets:
      slack_token:
        required: true
      github_token:
        required: true

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <org>/github-slack-notifications@v1
        with:
          event_type: pull_request
          slack_token: ${{ secrets.slack_token }}
          slack_channel: ${{ inputs.slack_channel }}
          github_token: ${{ secrets.github_token }}
          filter_labels: ${{ inputs.filter_labels }}
```

#### Issue用Workflow（`notify-issue.yml`）
#### Workflow用Workflow（`notify-workflow.yml`）

- [ ] 各Workflowファイルの作成
- [ ] 入力パラメータの定義
  - `slack_channel`: SlackチャンネルID
  - `slack_token`: Slack Bot Token（Secret）
  - `github_token`: GitHub App Token（Secret）
  - `label_filter_mode`: フィルタモード（`whitelist` or `blacklist`）
  - `filter_labels`: フィルタするラベル（カンマ区切り）
    - whitelist: 指定ラベルがあるものだけ通知（例: `notify-slack`）
    - blacklist: 指定ラベルがあるものを除外（例: `wip,draft`）
  - `workflow_names`: 通知対象のWorkflow名（カンマ区切り、Workflow用のみ）
  - `notify_on`: 通知タイミング（Workflow用、`success,failure` / `failure` など）

### 6. エラーハンドリングとロギング

- [ ] Slack API失敗時のエラー処理
  - エラーメッセージの詳細ログ出力
  - Workflowを失敗させる（`core.setFailed()`）
- [ ] GraphQL API失敗時のエラー処理
  - レート制限エラーのハンドリング
  - エラーメッセージの詳細ログ出力
- [ ] git操作失敗時のエラー処理
  - リトライ回数超過時のエラー
- [ ] 各処理ステップでの詳細ログ出力（`core.info()`, `core.debug()`）

### 7. ドキュメント作成

- [ ] `README.md`
  - プロジェクト概要
  - セットアップ手順
  - 使い方
  - 設定例
- [ ] サンプルWorkflowの作成
  - 実際のリポジトリでの使用例
  - 各イベントタイプごとのサンプル
- [ ] トラブルシューティングガイド
  - よくあるエラーと解決方法
  - FAQ

### 8. テスト

- [ ] ユニットテストの作成
  - Slack通知ロジックのテスト
  - ステート管理ロジックのテスト
  - フィルタリングロジックのテスト
- [ ] 統合テストの実施
  - 実際のリポジトリでの動作確認
  - 各イベントタイプでの通知確認
  - スレッド返信の動作確認
  - フィルタリングの動作確認

### 9. サマリー機能の実装

- [ ] サマリー処理ロジックの実装（`summary.ts`）
  - stateファイルから対象期間のデータ収集
  - PR、Issue別の分類処理
  - Block Kitでのサマリーメッセージ生成
- [ ] メッセージ削除機能の実装
  - `chat.delete` APIの呼び出し
  - 削除失敗時のエラーハンドリング（ログ出力して続行）
  - リトライ機構（オプション）
- [ ] reply先チェック機能の追加
  - 通知送信時にstateファイルで元メッセージの存在確認
  - 存在しない場合は`thread_ts`なしで投稿
- [ ] Reusable Workflow（`notify-summary.yml`）の作成
  - cronでのスケジュール実行設定
  - workflow_dispatchでの手動実行対応
  - 入力パラメータ定義：
    - `slack_channel`: SlackチャンネルID
    - `cron_schedule`: 実行時刻（cron式）
- [ ] サマリー機能のテスト
  - ユニットテスト（データ収集、メッセージ生成）
  - 統合テスト（実際のSlackチャンネルでの動作確認）
  - エッジケース（通知0件、削除失敗等）

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
  workflow_run:
    workflows: ["CI", "Deploy"]
    types: [completed]

jobs:
  notify-pr:
    if: github.event_name == 'pull_request'
    uses: <org>/github-slack-notifications/.github/workflows/notify-pr.yml@v1
    with:
      slack_channel: "C01234567"
    secrets:
      slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
      github_token: ${{ secrets.GITHUB_TOKEN }}

  notify-issue:
    if: github.event_name == 'issues'
    uses: <org>/github-slack-notifications/.github/workflows/notify-issue.yml@v1
    with:
      slack_channel: "C01234567"
    secrets:
      slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
      github_token: ${{ secrets.GITHUB_TOKEN }}

  notify-workflow:
    if: github.event_name == 'workflow_run'
    uses: <org>/github-slack-notifications/.github/workflows/notify-workflow.yml@v1
    with:
      slack_channel: "C01234567"
      workflow_names: "CI,Deploy"
    secrets:
      slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
      github_token: ${{ secrets.GITHUB_TOKEN }}
```

### サマリー機能の設定

`.github/workflows/slack-summary.yml`:

```yaml
name: Slack Daily Summary

on:
  schedule:
    # 毎日 23:59 JST (14:59 UTC) に実行
    - cron: '59 14 * * *'
  workflow_dispatch:  # 手動実行も可能

jobs:
  daily-summary:
    uses: <org>/github-slack-notifications/.github/workflows/notify-summary.yml@v1
    with:
      slack_channel: "C01234567"
    secrets:
      slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
      github_token: ${{ secrets.GITHUB_TOKEN }}
```

**重要**: サマリー機能を使用する場合は、通知用のWorkflowと一緒に設定してください。

---

## 参考情報

### 必要なSlack権限

Slack Appに以下の権限が必要：
- `chat:write` - メッセージ送信
- `chat:write.public` - 公開チャンネルへの投稿
- `chat:delete` - メッセージ削除（サマリー機能使用時）

### 必要なGitHub権限

GitHub App Tokenに以下の権限が必要：
- `contents: write` - ステートファイルのcommit/push
- `issues: read` - Issue情報の取得
- `pull_requests: read` - PR情報の取得

### GitHub App のセットアップ

1. **Organization Settings → Developer settings → GitHub Apps → New GitHub App**
2. **必要な設定**:
   - App name: `GitHub Slack Notifier` (任意)
   - Webhook: 無効化（Workflowからのみ使用）
   - Permissions:
     - Repository permissions:
       - Contents: Read and Write
       - Issues: Read-only
       - Pull requests: Read-only
       - Actions: Read-only（Workflow情報取得用）
3. **インストール**:
   - 対象リポジトリにインストール
4. **Secrets設定**:
   - `GITHUB_APP_ID`: App ID
   - `GITHUB_APP_PRIVATE_KEY`: Private Key（PEM形式）
5. **Workflowでの使用**:
   ```yaml
   - uses: actions/create-github-app-token@v1
     id: app-token
     with:
       app-id: ${{ secrets.GITHUB_APP_ID }}
       private-key: ${{ secrets.GITHUB_APP_PRIVATE_KEY }}
   - uses: <org>/github-slack-notifications@v1
     with:
       github_token: ${{ steps.app-token.outputs.token }}
   ```

### 外部リソース

- [Slack Block Kit Builder](https://api.slack.com/block-kit/building)
- [GitHub GraphQL API Explorer](https://docs.github.com/en/graphql/overview/explorer)
- [GitHub Actions: Reusable Workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)

---

## リスクと制約事項

### リスク

1. **同時実行時の競合**
   - 複数のイベントが同時発生した場合、git pushの競合が発生する可能性
   - リトライ機構で緩和するが、完全には防げない
   - **緩和策**: リトライ回数を増やす、または個別ファイルに分割

2. **ステートファイルの肥大化**
   - 長期間運用するとJSONファイルが大きくなる
   - **緩和策**: 定期的に古いエントリをクリーンアップ

3. **Slack API制限**
   - レート制限に引っかかる可能性
   - **緩和策**: エラーハンドリングとリトライ

4. **サマリー実行中の新しい通知**
   - サマリー作成中に新しいイベントが発生した場合、タイミング次第で削除される可能性
   - **緩和策**: サマリー実行時刻を営業時間外に設定

5. **メッセージ削除失敗**
   - Slack APIの制限や権限エラーで削除失敗の可能性
   - **緩和策**: 失敗してもログ出力して続行、手動削除で対応

### 制約事項

1. **GitHub ActionsのCache/Artifactsは使用しない**
   - 保存期限（7日間）の制約があるため、リポジトリファイルを使用

2. **コメント通知は対象外**
   - Issue/PRのコメントは通知しない
   - ノイズ削減のための意図的な制約

3. **Review通知は対象外**
   - PR Reviewは通知しない
   - 必要であれば将来的に追加可能

---

## 今後の拡張案

- [ ] コメント通知のオプション追加
- [ ] Review通知のオプション追加
- [ ] ステートファイルの自動クリーンアップ機能
- [ ] Slack UIでの通知設定変更（ボタンでフィルタ追加等）
- [ ] 複数Slackワークスペース対応
- [ ] Discord、Teams等の他の通知サービス対応
- [ ] サマリーに統計情報を追加（PR/Issueの件数、成功率等）
- [ ] Workflow実行結果をサマリーに含める（オプション）
- [ ] サマリーの頻度をカスタマイズ（毎日、毎週等）
- [ ] アーカイブ用の別チャンネルへの転送機能
