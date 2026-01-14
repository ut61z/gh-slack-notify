import * as core from '@actions/core';
import * as github from '@actions/github';
import { DefaultArtifactClient } from '@actions/artifact';
import AdmZip from 'adm-zip';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { NotificationState, PullRequestEntry, IssueEntry } from './types.js';
import { getEncryptionKey, encryptEntry, decryptEntry, isEncrypted, isEncryptionEnabled } from './crypto.js';

const ARTIFACT_NAME = 'slack-notification-state';
const STATE_FILE_NAME = 'state.json';

let octokit: ReturnType<typeof github.getOctokit> | null = null;
const artifactClient = new DefaultArtifactClient();

// Initialize the artifact client with GitHub token
export function initArtifactClient(token: string): void {
  octokit = github.getOctokit(token);
}

function getOctokit(): ReturnType<typeof github.getOctokit> {
  if (!octokit) {
    throw new Error('Artifact client not initialized. Call initArtifactClient first.');
  }
  return octokit;
}

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

// Parse stored state (handle encryption)
function parseStoredState(content: string): NotificationState {
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
}

// Serialize state for storage (handle encryption)
function serializeState(state: NotificationState): string {
  if (!isEncryptionEnabled()) {
    // デバッグモード: 平文で保存
    return JSON.stringify(state, null, 2);
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

  return JSON.stringify(stored, null, 2);
}

// Download the latest state artifact
async function downloadLatestState(): Promise<NotificationState> {
  const client = getOctokit();
  const { owner, repo } = github.context.repo;

  try {
    // List artifacts with name filter
    const { data } = await client.rest.actions.listArtifactsForRepo({
      owner,
      repo,
      name: ARTIFACT_NAME,
      per_page: 1,
    });

    const latestArtifact = data.artifacts[0];
    if (!latestArtifact) {
      core.info('No existing state artifact found, starting fresh');
      return getEmptyState();
    }

    core.info(`Found state artifact: ${latestArtifact.id} (created: ${latestArtifact.created_at})`);

    // Download the artifact (returns a zip)
    const downloadResponse = await client.rest.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: latestArtifact.id,
      archive_format: 'zip',
    });

    // Extract the zip and read the state file
    const zip = new AdmZip(Buffer.from(downloadResponse.data as ArrayBuffer));
    const stateEntry = zip.getEntry(STATE_FILE_NAME);

    if (!stateEntry) {
      core.warning('State file not found in artifact, starting fresh');
      return getEmptyState();
    }

    const stateContent = stateEntry.getData().toString('utf-8');
    return parseStoredState(stateContent);
  } catch (error) {
    // 404 or other errors mean no artifact exists
    if ((error as { status?: number }).status === 404) {
      core.info('No state artifact found (404), starting fresh');
      return getEmptyState();
    }
    core.warning(`Failed to download state artifact: ${error}`);
    return getEmptyState();
  }
}

// Upload state as an artifact
async function uploadState(state: NotificationState): Promise<void> {
  // Create a temporary directory for the state file
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slack-state-'));
  const stateFilePath = path.join(tmpDir, STATE_FILE_NAME);

  try {
    // Write state to temporary file (with encryption if enabled)
    await fs.writeFile(stateFilePath, serializeState(state));

    // Upload as artifact
    const { id } = await artifactClient.uploadArtifact(ARTIFACT_NAME, [stateFilePath], tmpDir, {
      retentionDays: 90,
    });

    core.info(`State artifact uploaded successfully (id: ${id})`);
  } finally {
    // Clean up temporary directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// Read state (public API)
export async function readState(): Promise<NotificationState> {
  return downloadLatestState();
}

// Save state with merge support and race condition mitigation
// skipMerge: true の場合、既存の state とマージせずに上書きする（summary 後のクリア用）
export async function saveState(state: NotificationState, skipMerge = false): Promise<void> {
  let stateToSave: NotificationState;

  if (skipMerge) {
    stateToSave = state;
  } else {
    // Re-download latest state just before saving to minimize race condition window
    const latestState = await downloadLatestState();

    // Merge: latest + new entries (new entries take precedence)
    stateToSave = {
      last_summary_at: state.last_summary_at ?? latestState.last_summary_at,
      pull_requests: { ...latestState.pull_requests, ...state.pull_requests },
      issues: { ...latestState.issues, ...state.issues },
    };
  }

  await uploadState(stateToSave);
  core.info('State saved successfully');
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
