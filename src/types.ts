// Event types
export type EventType = 'pull_request' | 'issues' | 'workflow_run' | 'summary';

export type ItemKind = 'pr' | 'issue';

export interface ItemMetadataPayload {
  kind: ItemKind;
  repo: string;
  number: number;
  title: string;
  url: string;
}

export interface SummaryMetadataPayload {
  repo: string;
}

export type MessageMetadata =
  | { eventType: 'gh_slack_notify_item'; payload: ItemMetadataPayload }
  | { eventType: 'gh_slack_notify_summary'; payload: SummaryMetadataPayload };

export interface TrackedItem extends ItemMetadataPayload {
  ts: string;
}

export interface ChannelActivity {
  items: TrackedItem[];
  lastSummaryTs: string | null;
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
