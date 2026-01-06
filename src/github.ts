import { graphql } from '@octokit/graphql';
import * as core from '@actions/core';

let graphqlClient: typeof graphql | null = null;

export function initGitHubClient(token: string): void {
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
