import { graphql } from '@octokit/graphql';
import * as core from '@actions/core';
import * as github from '@actions/github';

const PAGE_SIZE = 100;

let graphqlClient: typeof graphql | null = null;
let restClient: ReturnType<typeof github.getOctokit> | null = null;

export function initGitHubClient(token: string): void {
  restClient = github.getOctokit(token);
  graphqlClient = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });
}

function getGraphQLClient(): typeof graphql {
  if (!graphqlClient) {
    throw new Error('GitHub client not initialized. Call initGitHubClient first.');
  }
  return graphqlClient;
}

export function getRestClient(): ReturnType<typeof github.getOctokit> {
  if (!restClient) {
    throw new Error('GitHub client not initialized. Call initGitHubClient first.');
  }
  return restClient;
}

export interface RepoItem {
  number: number;
  title: string;
  url: string;
  labels: string[];
}

export interface PullRequestItem extends RepoItem {
  draft: boolean;
  baseBranch: string;
}

export interface ClosedPullRequest extends PullRequestItem {
  merged: boolean;
}

function labelNames(labels: Array<string | { name?: string }>): string[] {
  return labels.map((label) => (typeof label === 'string' ? label : (label.name ?? '')));
}

export async function listClosedPullRequests(
  owner: string,
  repo: string,
  since: Date
): Promise<ClosedPullRequest[]> {
  const pulls: ClosedPullRequest[] = [];

  for (let page = 1; ; page++) {
    const { data } = await getRestClient().rest.pulls.list({
      owner,
      repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: PAGE_SIZE,
      page,
    });

    for (const pr of data) {
      if (new Date(pr.updated_at) < since) {
        return pulls;
      }
      if (pr.closed_at && new Date(pr.closed_at) >= since) {
        pulls.push({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          labels: labelNames(pr.labels),
          merged: pr.merged_at !== null,
          draft: pr.draft === true,
          baseBranch: pr.base.ref,
        });
      }
    }

    if (data.length < PAGE_SIZE) {
      return pulls;
    }
  }
}

export async function listClosedIssues(owner: string, repo: string, since: Date): Promise<RepoItem[]> {
  const issues: RepoItem[] = [];

  for (let page = 1; ; page++) {
    const { data } = await getRestClient().rest.issues.listForRepo({
      owner,
      repo,
      state: 'closed',
      since: since.toISOString(),
      per_page: PAGE_SIZE,
      page,
    });

    for (const issue of data) {
      if (!issue.pull_request && issue.closed_at && new Date(issue.closed_at) >= since) {
        issues.push({
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          labels: labelNames(issue.labels),
        });
      }
    }

    if (data.length < PAGE_SIZE) {
      return issues;
    }
  }
}

interface OpenPullRequestNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  labels: { nodes: Array<{ name: string }> };
  timelineItems: { nodes: Array<{ createdAt?: string }> };
}

interface OpenPullRequestsResponse {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: OpenPullRequestNode[];
    };
  };
}

// Includes PRs created as draft and marked ready for review within the period
export async function listOpenedPullRequests(
  owner: string,
  repo: string,
  since: Date
): Promise<PullRequestItem[]> {
  const pulls: PullRequestItem[] = [];
  let cursor: string | null = null;

  while (true) {
    const response: OpenPullRequestsResponse = await getGraphQLClient()<OpenPullRequestsResponse>(
      `
      query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequests(states: OPEN, first: ${PAGE_SIZE}, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
            pageInfo { hasNextPage endCursor }
            nodes {
              number
              title
              url
              isDraft
              createdAt
              updatedAt
              baseRefName
              labels(first: 100) { nodes { name } }
              timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) {
                nodes { ... on ReadyForReviewEvent { createdAt } }
              }
            }
          }
        }
      }
    `,
      { owner, repo, cursor }
    );
    const { pageInfo, nodes } = response.repository.pullRequests;

    for (const pr of nodes) {
      if (new Date(pr.updatedAt) < since) {
        return pulls;
      }
      const reviewableAt = pr.timelineItems.nodes[0]?.createdAt ?? pr.createdAt;
      if (new Date(reviewableAt) >= since) {
        pulls.push({
          number: pr.number,
          title: pr.title,
          url: pr.url,
          labels: pr.labels.nodes.map((label) => label.name),
          draft: pr.isDraft,
          baseBranch: pr.baseRefName,
        });
      }
    }

    if (!pageInfo.hasNextPage) {
      return pulls;
    }
    cursor = pageInfo.endCursor;
  }
}

export async function listOpenedIssues(owner: string, repo: string, since: Date): Promise<RepoItem[]> {
  const issues: RepoItem[] = [];

  for (let page = 1; ; page++) {
    const { data } = await getRestClient().rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      since: since.toISOString(),
      per_page: PAGE_SIZE,
      page,
    });

    for (const issue of data) {
      if (!issue.pull_request && new Date(issue.created_at) >= since) {
        issues.push({
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          labels: labelNames(issue.labels),
        });
      }
    }

    if (data.length < PAGE_SIZE) {
      return issues;
    }
  }
}

// Check if an issue is linked to a GitHub Project
export async function isIssueLinkedToProject(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<boolean> {
  const client = getGraphQLClient();

  try {
    const response = await client<{
      repository: {
        issue: {
          projectItems: {
            totalCount: number;
          };
        };
      };
    }>(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            projectItems(first: 1) {
              totalCount
            }
          }
        }
      }
    `,
      {
        owner,
        repo,
        number: issueNumber,
      }
    );

    const totalCount = response.repository.issue.projectItems.totalCount;
    core.debug(`Issue #${issueNumber} has ${totalCount} project items`);

    return totalCount > 0;
  } catch (error) {
    core.warning(`Failed to check project link for issue #${issueNumber}: ${error}`);
    // If we can't check, don't exclude the issue
    return false;
  }
}

// Check if labels match the filter
export function shouldNotifyByLabels(
  labels: string[],
  filterMode: 'whitelist' | 'blacklist' | '',
  filterLabels: string[]
): boolean {
  if (!filterMode || filterLabels.length === 0) {
    // No filter configured, always notify
    return true;
  }

  const hasMatchingLabel = labels.some((label) =>
    filterLabels.some((filterLabel) => label.toLowerCase() === filterLabel.toLowerCase())
  );

  if (filterMode === 'whitelist') {
    // Whitelist: only notify if at least one label matches
    return hasMatchingLabel;
  } else {
    // Blacklist: don't notify if any label matches
    return !hasMatchingLabel;
  }
}

// Check if base branch matches the filter
export function shouldNotifyByBaseBranch(
  baseBranch: string,
  baseBranches: string[]
): boolean {
  if (baseBranches.length === 0 || baseBranches.includes('all')) {
    // No filter configured or 'all' specified, always notify
    return true;
  }

  // Check if base branch matches any of the configured branches
  return baseBranches.some(
    (branch) => branch.toLowerCase() === baseBranch.toLowerCase()
  );
}
