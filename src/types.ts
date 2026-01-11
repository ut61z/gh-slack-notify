// Event types
export type EventType = 'pull_request' | 'issues' | 'workflow_run' | 'summary';

// PR entry in state
export interface PullRequestEntry {
  channel: string;
  message_ts: string;
  reply_message_ts?: string;
  created_at: string;
  event: 'opened' | 'closed' | 'merged';
  title: string;
  url: string;
  repo: string;
  author: string;
}

// Issue entry in state
export interface IssueEntry {
  channel: string;
  message_ts: string;
  reply_message_ts?: string;
  created_at: string;
  event: 'opened' | 'closed';
  title: string;
  url: string;
  repo: string;
  author: string;
}

// State file structure
export interface NotificationState {
  last_summary_at?: string;
  pull_requests: Record<string, PullRequestEntry>;
  issues: Record<string, IssueEntry>;
}

// Action inputs
export interface ActionInputs {
  eventType: EventType;
  slackToken: string;
  slackChannel: string;
  githubToken: string;
  labelFilterMode: 'whitelist' | 'blacklist' | '';
  filterLabels: string[];
  excludeProjectIssues: boolean;
  workflowNames: string[];
  notifyOn: string[];
  baseBranches: string[];
}

// Slack message colors
export const COLORS = {
  OPEN: '#36a64f',      // Green
  MERGED: '#8B5CF6',    // Purple
  CLOSED: '#8B5CF6',    // Purple
  SUCCESS: '#36a64f',   // Green
  FAILURE: '#F44336',   // Red
} as const;
