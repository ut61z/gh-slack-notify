// Event types
export type EventType = 'pull_request' | 'issues' | 'workflow_run' | 'summary';

// Author info
export interface Author {
  login: string;
  avatar_url: string;
}

// PR entry in state
export interface PullRequestEntry {
  channel: string;
  message_ts: string;
  created_at: string;
  event: 'opened' | 'closed' | 'merged';
  title: string;
  url: string;
  repo: string;
  author: Author;
}

// Issue entry in state
export interface IssueEntry {
  channel: string;
  message_ts: string;
  created_at: string;
  event: 'opened' | 'closed';
  title: string;
  url: string;
  repo: string;
  author: Author;
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
}

// Slack message colors
export const COLORS = {
  OPEN: '#2196F3',      // Blue
  MERGED: '#4CAF50',    // Green
  CLOSED: '#F44336',    // Red
  SUCCESS: '#4CAF50',   // Green
  FAILURE: '#F44336',   // Red
} as const;
