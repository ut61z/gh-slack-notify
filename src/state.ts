import * as core from '@actions/core';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { NotificationState, PullRequestEntry, IssueEntry } from './types.js';

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

// Read state file
export async function readState(): Promise<NotificationState> {
  try {
    const content = await fs.readFile(STATE_FILE_PATH, 'utf-8');
    return JSON.parse(content) as NotificationState;
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
  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2));
}

// Execute git command
async function gitExec(command: string): Promise<string> {
  const { stdout } = await execAsync(command);
  return stdout.trim();
}

// Save state with git commit and push (with retry)
export async function saveState(state: NotificationState): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Pull latest changes
      await gitExec('git pull origin HEAD --rebase');

      // Read current state and merge
      const currentState = await readState();
      const mergedState: NotificationState = {
        last_summary_at: state.last_summary_at ?? currentState.last_summary_at,
        pull_requests: { ...currentState.pull_requests, ...state.pull_requests },
        issues: { ...currentState.issues, ...state.issues },
      };

      // Write merged state
      await writeState(mergedState);

      // Git add, commit, push
      await gitExec(`git add ${STATE_FILE_PATH}`);

      // Check if there are changes to commit
      const status = await gitExec('git status --porcelain');
      if (!status.includes(STATE_FILE_PATH)) {
        core.info('No changes to commit');
        return;
      }

      await gitExec('git commit -m "chore: Slack通知ステート更新"');
      await gitExec('git push origin HEAD');

      core.info('State saved successfully');
      return;
    } catch (error) {
      core.warning(`Attempt ${attempt}/${MAX_RETRIES} failed: ${error}`);

      if (attempt < MAX_RETRIES) {
        core.info(`Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

        // Reset any local changes before retry
        try {
          await gitExec('git reset --hard HEAD');
          await gitExec('git clean -fd');
        } catch {
          // Ignore reset errors
        }
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
