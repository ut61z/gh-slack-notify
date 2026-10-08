// Event types
export type EventType = 'pull_request' | 'issues' | 'workflow_run' | 'summary';

export type ItemKind = 'pr' | 'issue';
export type ItemEvent = 'opened' | 'closed' | 'merged';

export interface ItemMetadataPayload {
  kind: ItemKind;
  repo: string;
  number: number;
  title: string;
  url: string;
  event: ItemEvent;
}

export interface TrackedItem extends ItemMetadataPayload {
  ts: string;
  threadTs: string | null;
  replyCount: number;
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
