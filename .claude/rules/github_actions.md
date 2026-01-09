：---
paths: .github/workflows/**/*.yml
---

# GitHub Actions ルール

## バージョン管理

- 外部Actionsは必ずcommit hashでバージョンを指定する
- タグ（`v4`など）での指定は禁止
- ワークフローファイル作成・編集後は `pinact run .github/workflows/*.yml` を実行してバージョンをピン留めする

## Permissions（最小権限の原則）

- ワークフローレベルまたはジョブレベルで必ず `permissions` を明示的に指定する
- 必要最小限の権限のみを付与する（デフォルトの広い権限に依存しない）
- 使用する権限の例:
  - `contents: read` - リポジトリのチェックアウトのみ
  - `contents: write` - ファイルの作成・更新・コミットが必要な場合
  - `pull-requests: write` - PRへのコメントやレビューが必要な場合
  - `issues: write` - Issueの操作が必要な場合
- 権限が不要な場合は `permissions: {}` で空にする
