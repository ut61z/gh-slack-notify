import { graphql } from '@octokit/graphql';
import * as core from '@actions/core';
import * as github from '@actions/github';

const PAGE_SIZE = 100;

let graphqlClient: typeof graphql | null = null;
let restClient: ReturnType<typeof github.getOctokit> | null = null;

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export interface ClosedItem {
  number: number;
  title: string;
  url: string;
  labels: string[];
}

export interface ClosedPullRequest extends ClosedItem {
  merged: boolean;
  draft: boolean;
  baseBranch: string;
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

export async function listClosedIssues(owner: string, repo: string, since: Date): Promise<ClosedItem[]> {
  const issues: ClosedItem[] = [];

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

// Check if an issue is linked to a GitHub Project
export async function isIssueLinkedToProject(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<boolean> {
  const client = getGraphQLClient();

  // Wait for Project linkage to be reflected (GitHub may have delay)
  const DELAY_MS = 3000;
  core.info(`Waiting ${DELAY_MS}ms for Project linkage to be reflected...`);
  await sleep(DELAY_MS);

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
