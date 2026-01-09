：---
paths: .github/workflows/**/*.yml
---

# GitHub Actions ルール

- 外部Actionsは必ずcommit hashでバージョンを指定する
- タグ（`v4`など）での指定は禁止
- ワークフローファイル作成・編集後は `pinact run .github/workflows/*.yml` を実行してバージョンをピン留めする
