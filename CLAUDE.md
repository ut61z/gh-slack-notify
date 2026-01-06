# gh-slack-notify

GitHub to Slack notification action.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Package Manager: Bun

## Commands

- `bun run build` - Build to dist/index.js
- `bun run dev` - Run locally
- `bun run typecheck` - Type check
- `bun test` - Run tests

## Project Structure

```
src/
  index.ts    - Main entry point
  slack.ts    - Slack API client & Block Kit messages
  state.ts    - State management (JSON + git)
  github.ts   - GitHub GraphQL API
  summary.ts  - Daily summary feature
dist/
  index.js    - Bundled output (committed)
action.yml    - Composite Action definition
```

## Git Commit

Use semantic commit messages in Japanese:
- feat: 新機能
- fix: バグ修正
- docs: ドキュメント
- style: フォーマット
- refactor: リファクタリング
- test: テスト
- chore: その他
