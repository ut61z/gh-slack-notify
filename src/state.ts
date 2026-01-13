import * as core from '@actions/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { NotificationState, PullRequestEntry, IssueEntry } from './types.js';
import { getEncryptionKey, encryptEntry, decryptEntry, isEncrypted, isEncryptionEnabled } from './crypto.js';

const execAsync = promisify(exec);

const STATE_FILE_PATH = '.github/slack-notifications.json';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Get empty state
function getEmptyState(): NotificationState {
  return {
    pull_requests: {},
    issues: {},
  };
}

// ファイルに保存される形式（暗号化時）
interface StoredNotificationState {
  last_summary_at?: string;
  pull_requests: Record<string, string | PullRequestEntry>;
  issues: Record<string, string | IssueEntry>;
}

// Read state file
export async function readState(): Promise<NotificationState> {
  try {
    const content = await fs.readFile(STATE_FILE_PATH, 'utf-8');
    const stored = JSON.parse(content) as StoredNotificationState;

    if (!isEncryptionEnabled()) {
      // デバッグモード: 平文で読み込み
      return {
        last_summary_at: stored.last_summary_at,
        pull_requests: stored.pull_requests as Record<string, PullRequestEntry>,
        issues: stored.issues as Record<string, IssueEntry>,
      };
    }

    // 暗号化モード: 各エントリを復号
    const key = getEncryptionKey();
    const pullRequests: Record<string, PullRequestEntry> = {};
    for (const [prNumber, entry] of Object.entries(stored.pull_requests)) {
      if (typeof entry === 'string' && isEncrypted(entry)) {
        pullRequests[prNumber] = decryptEntry<PullRequestEntry>(entry, key);
      }
    }

    const issues: Record<string, IssueEntry> = {};
    for (const [issueNumber, entry] of Object.entries(stored.issues)) {
      if (typeof entry === 'string' && isEncrypted(entry)) {
        issues[issueNumber] = decryptEntry<IssueEntry>(entry, key);
      }
    }

    return {
      last_summary_at: stored.last_summary_at,
      pull_requests: pullRequests,
      issues: issues,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      core.info('State file not found, creating new state');
      return getEmptyState();
    }
    throw error;
  }
}

// Write state file
async function writeState(state: NotificationState): Promise<void> {
  const dir = path.dirname(STATE_FILE_PATH);
  await fs.mkdir(dir, { recursive: true });

  if (!isEncryptionEnabled()) {
    // デバッグモード: 平文で保存
    await fs.writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2));
    return;
  }

  // 暗号化して保存
  const key = getEncryptionKey();
  const stored: StoredNotificationState = {
    last_summary_at: state.last_summary_at,
    pull_requests: {},
    issues: {},
  };

  for (const [prNumber, entry] of Object.entries(state.pull_requests)) {
    stored.pull_requests[prNumber] = encryptEntry(entry, key);
  }

  for (const [issueNumber, entry] of Object.entries(state.issues)) {
    stored.issues[issueNumber] = encryptEntry(entry, key);
  }

  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(stored, null, 2));
}

// Execute git command
async function gitExec(command: string): Promise<string> {
  const { stdout } = await execAsync(command);
  return stdout.trim();
}

// Clean up any git state issues
async function cleanupGitState(): Promise<void> {
  try {
    await execAsync('git rebase --abort').catch(() => {});
    await execAsync('git merge --abort').catch(() => {});
    await execAsync('git reset --hard HEAD').catch(() => {});
    await execAsync('git clean -fd').catch(() => {});
  } catch {
    // Ignore cleanup errors
  }
}

// Get the target branch for pushing state
function getTargetBranch(): string {
  // For PR events, use the base branch (main/master)
  // For other events, use GITHUB_REF_NAME
  const refName = process.env.GITHUB_REF_NAME;
  const baseRef = process.env.GITHUB_BASE_REF; // Set for PR events

  if (baseRef) {
    // PR event - push to base branch
    return baseRef;
  }

  if (refName && refName !== 'merge') {
    return refName;
  }

  // Fallback to main
  return 'main';
}

// Save state with git commit and push (with retry)
// skipMerge: trueの場合、既存のstateとマージせずに上書きする（summary後のクリア用）
export async function saveState(state: NotificationState, skipMerge = false): Promise<void> {
  const branch = getTargetBranch();
  core.info(`Target branch for state: ${branch}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Always clean up first
      await cleanupGitState();

      // Fetch latest from remote
      await gitExec('git fetch origin');

      // Checkout the target branch
      try {
        await gitExec(`git checkout ${branch}`);
      } catch {
        // If branch doesn't exist locally, create it from origin
        await gitExec(`git checkout -b ${branch} origin/${branch}`);
      }

      // Pull latest changes (no rebase, just merge)
      try {
        await gitExec(`git pull origin ${branch} --no-rebase`);
      } catch {
        core.warning('Pull failed, continuing with current state');
      }

      // skipMergeがfalseの場合のみマージする
      let stateToWrite: NotificationState;
      if (skipMerge) {
        stateToWrite = state;
      } else {
        const currentState = await readState();
        stateToWrite = {
          last_summary_at: state.last_summary_at ?? currentState.last_summary_at,
          pull_requests: { ...currentState.pull_requests, ...state.pull_requests },
          issues: { ...currentState.issues, ...state.issues },
        };
      }

      // Write state
      await writeState(stateToWrite);

      // Git add, commit, push
      await gitExec(`git add ${STATE_FILE_PATH}`);

      // Check if there are changes to commit
      const status = await gitExec('git status --porcelain');
      if (!status.includes(STATE_FILE_PATH)) {
        core.info('No changes to commit');
        return;
      }

      await gitExec('git commit -m "chore: Slack通知ステート更新"');
      await gitExec(`git push origin ${branch}`);

      core.info('State saved successfully');
      return;
    } catch (error) {
      core.warning(`Attempt ${attempt}/${MAX_RETRIES} failed: ${error}`);

      if (attempt < MAX_RETRIES) {
        core.info(`Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        await cleanupGitState();
      } else {
        core.warning('All retry attempts failed. Notification was sent but state may be lost.');
      }
    }
  }
}

// Add PR entry to state
export function addPREntry(
  state: NotificationState,
  prNumber: string,
  entry: PullRequestEntry
): void {
  state.pull_requests[prNumber] = entry;
}

// Get PR entry from state
export function getPREntry(
  state: NotificationState,
  prNumber: string
): PullRequestEntry | undefined {
  return state.pull_requests[prNumber];
}

// Update PR entry in state
export function updatePREntry(
  state: NotificationState,
  prNumber: string,
  updates: Partial<PullRequestEntry>
): void {
  const existing = state.pull_requests[prNumber];
  if (existing) {
    state.pull_requests[prNumber] = { ...existing, ...updates };
  }
}

// Add Issue entry to state
export function addIssueEntry(
  state: NotificationState,
  issueNumber: string,
  entry: IssueEntry
): void {
  state.issues[issueNumber] = entry;
}

// Get Issue entry from state
export function getIssueEntry(
  state: NotificationState,
  issueNumber: string
): IssueEntry | undefined {
  return state.issues[issueNumber];
}

// Update Issue entry in state
export function updateIssueEntry(
  state: NotificationState,
  issueNumber: string,
  updates: Partial<IssueEntry>
): void {
  const existing = state.issues[issueNumber];
  if (existing) {
    state.issues[issueNumber] = { ...existing, ...updates };
  }
}

// Clear entries (for summary cleanup)
export function clearEntries(state: NotificationState): void {
  state.pull_requests = {};
  state.issues = {};
}

// Update last summary timestamp
export function updateLastSummaryAt(state: NotificationState): void {
  state.last_summary_at = new Date().toISOString();
}
