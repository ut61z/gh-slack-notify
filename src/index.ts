import * as core from '@actions/core';
import * as github from '@actions/github';
import { initSlackClient, postMessage, buildPRBlocks, buildIssueBlocks, buildWorkflowBlocks } from './slack.js';
import { initGitHubClient, isIssueLinkedToProject, shouldNotifyByLabels } from './github.js';
import { readState, saveState, addPREntry, getPREntry, addIssueEntry, getIssueEntry } from './state.js';
import { runSummary } from './summary.js';
import type { ActionInputs, EventType } from './types.js';

// Parse inputs from environment variables
function getInputs(): ActionInputs {
  const eventType = (process.env.INPUT_EVENT_TYPE || '') as EventType;
  const slackToken = process.env.INPUT_SLACK_TOKEN || '';
  const slackChannel = process.env.INPUT_SLACK_CHANNEL || '';
  const githubToken = process.env.INPUT_GITHUB_TOKEN || '';
  const labelFilterMode = (process.env.INPUT_LABEL_FILTER_MODE || '') as 'whitelist' | 'blacklist' | '';
  const filterLabels = (process.env.INPUT_FILTER_LABELS || '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  const excludeProjectIssues = process.env.INPUT_EXCLUDE_PROJECT_ISSUES !== 'false';
  const workflowNames = (process.env.INPUT_WORKFLOW_NAMES || '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  const notifyOn = (process.env.INPUT_NOTIFY_ON || 'success,failure')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  return {
    eventType,
    slackToken,
    slackChannel,
    githubToken,
    labelFilterMode,
    filterLabels,
    excludeProjectIssues,
    workflowNames,
    notifyOn,
  };
}

// Handle pull_request events
async function handlePullRequest(inputs: ActionInputs): Promise<void> {
  const { payload, repo } = github.context;
  const pr = payload.pull_request;

  if (!pr) {
    throw new Error('No pull_request in payload');
  }

  const action = payload.action as string;
  const prNumber = pr.number.toString();
  const isMerged = pr.merged === true;

  // Determine the actual event type
  let prEvent: 'opened' | 'closed' | 'merged';
  if (action === 'opened') {
    prEvent = 'opened';
  } else if (action === 'closed') {
    prEvent = isMerged ? 'merged' : 'closed';
  } else {
    core.info(`Ignoring PR action: ${action}`);
    return;
  }

  // Check label filter
  const labels = (pr.labels || []).map((l: { name: string }) => l.name);
  if (!shouldNotifyByLabels(labels, inputs.labelFilterMode, inputs.filterLabels)) {
    core.info('PR filtered out by label filter');
    core.setOutput('notified', 'false');
    return;
  }

  const prTitle = pr.title || `PR #${pr.number}`;
  const prUrl = pr.html_url || `https://github.com/${repo.owner}/${repo.repo}/pull/${pr.number}`;
  const prBody = pr.body || undefined;
  const author = pr.user?.login || 'unknown';

  const state = await readState();

  if (prEvent === 'opened') {
    // Send new message
    const blocks = buildPRBlocks({
      action: 'opened',
      title: prTitle,
      url: prUrl,
      number: pr.number,
      repo: repo.repo,
      author,
      body: prBody,
    });

    const messageTs = await postMessage(inputs.slackChannel, blocks, `PR #${pr.number}: ${prTitle}`);

    // Save to state
    addPREntry(state, prNumber, {
      channel: inputs.slackChannel,
      message_ts: messageTs,
      created_at: new Date().toISOString(),
      event: 'opened',
      title: prTitle,
      url: prUrl,
      repo: repo.repo,
      author,
    });

    await saveState(state);
    core.setOutput('message_ts', messageTs);
  } else {
    // Reply to existing thread or send new message
    const existingEntry = getPREntry(state, prNumber);
    const threadTs = existingEntry?.message_ts;

    const blocks = buildPRBlocks({
      action: prEvent,
      title: prTitle,
      url: prUrl,
      number: pr.number,
      repo: repo.repo,
      author,
    });

    const messageTs = await postMessage(
      inputs.slackChannel,
      blocks,
      `PR #${pr.number} ${prEvent}`,
      threadTs,
      true // reply_broadcast: チャンネルにも通知
    );

    // Update state
    if (existingEntry) {
      existingEntry.event = prEvent;
      existingEntry.reply_message_ts = messageTs;
    } else {
      addPREntry(state, prNumber, {
        channel: inputs.slackChannel,
        message_ts: messageTs,
        created_at: new Date().toISOString(),
        event: prEvent,
        title: prTitle,
        url: prUrl,
        repo: repo.repo,
        author,
      });
    }

    await saveState(state);
    core.setOutput('message_ts', messageTs);
  }

  core.setOutput('notified', 'true');
  core.info(`PR #${pr.number} ${prEvent} notification sent`);
}

// Handle issues events
async function handleIssue(inputs: ActionInputs): Promise<void> {
  const { payload, repo } = github.context;
  const issue = payload.issue;

  if (!issue) {
    throw new Error('No issue in payload');
  }

  const action = payload.action as string;
  const issueNumber = issue.number.toString();

  // Determine the actual event type
  let issueEvent: 'opened' | 'closed';
  if (action === 'opened') {
    issueEvent = 'opened';
  } else if (action === 'closed') {
    issueEvent = 'closed';
  } else {
    core.info(`Ignoring issue action: ${action}`);
    return;
  }

  // Check label filter
  const labels = (issue.labels || []).map((l: { name: string }) => l.name);
  if (!shouldNotifyByLabels(labels, inputs.labelFilterMode, inputs.filterLabels)) {
    core.info('Issue filtered out by label filter');
    core.setOutput('notified', 'false');
    return;
  }

  // Check if issue is linked to a project
  if (inputs.excludeProjectIssues && issueEvent === 'opened') {
    const isLinked = await isIssueLinkedToProject(repo.owner, repo.repo, issue.number);
    if (isLinked) {
      core.info('Issue is linked to a project, skipping notification');
      core.setOutput('notified', 'false');
      return;
    }
  }

  const issueTitle = issue.title || `Issue #${issue.number}`;
  const issueUrl = issue.html_url || `https://github.com/${repo.owner}/${repo.repo}/issues/${issue.number}`;
  const issueBody = issue.body || undefined;
  const author = issue.user?.login || 'unknown';

  const state = await readState();

  if (issueEvent === 'opened') {
    // Send new message
    const blocks = buildIssueBlocks({
      action: 'opened',
      title: issueTitle,
      url: issueUrl,
      number: issue.number,
      repo: repo.repo,
      author,
      body: issueBody,
    });

    const messageTs = await postMessage(inputs.slackChannel, blocks, `Issue #${issue.number}: ${issueTitle}`);

    // Save to state
    addIssueEntry(state, issueNumber, {
      channel: inputs.slackChannel,
      message_ts: messageTs,
      created_at: new Date().toISOString(),
      event: 'opened',
      title: issueTitle,
      url: issueUrl,
      repo: repo.repo,
      author,
    });

    await saveState(state);
    core.setOutput('message_ts', messageTs);
  } else {
    // Reply to existing thread or send new message
    const existingEntry = getIssueEntry(state, issueNumber);
    const threadTs = existingEntry?.message_ts;

    const blocks = buildIssueBlocks({
      action: 'closed',
      title: issueTitle,
      url: issueUrl,
      number: issue.number,
      repo: repo.repo,
      author,
    });

    const messageTs = await postMessage(
      inputs.slackChannel,
      blocks,
      `Issue #${issue.number} closed`,
      threadTs
    );

    // Update state
    if (existingEntry) {
      existingEntry.event = 'closed';
      existingEntry.reply_message_ts = messageTs;
    } else {
      addIssueEntry(state, issueNumber, {
        channel: inputs.slackChannel,
        message_ts: messageTs,
        created_at: new Date().toISOString(),
        event: 'closed',
        title: issueTitle,
        url: issueUrl,
        repo: repo.repo,
        author,
      });
    }

    await saveState(state);
    core.setOutput('message_ts', messageTs);
  }

  core.setOutput('notified', 'true');
  core.info(`Issue #${issue.number} ${issueEvent} notification sent`);
}

// Handle workflow_run events
async function handleWorkflowRun(inputs: ActionInputs): Promise<void> {
  const { payload, repo } = github.context;
  const workflowRun = payload.workflow_run;

  if (!workflowRun) {
    throw new Error('No workflow_run in payload');
  }

  const workflowName = workflowRun.name as string;
  const conclusion = workflowRun.conclusion as string;

  // Check if this workflow should be notified
  if (inputs.workflowNames.length > 0) {
    const shouldNotify = inputs.workflowNames.some(
      (name) => name.toLowerCase() === workflowName.toLowerCase()
    );
    if (!shouldNotify) {
      core.info(`Workflow "${workflowName}" not in notification list`);
      core.setOutput('notified', 'false');
      return;
    }
  }

  // Check conclusion filter
  if (!inputs.notifyOn.includes(conclusion)) {
    core.info(`Workflow conclusion "${conclusion}" not in notify_on list`);
    core.setOutput('notified', 'false');
    return;
  }

  // Calculate duration
  const startedAt = new Date(workflowRun.run_started_at);
  const updatedAt = new Date(workflowRun.updated_at);
  const duration = Math.round((updatedAt.getTime() - startedAt.getTime()) / 1000);

  const blocks = buildWorkflowBlocks({
    conclusion: conclusion as 'success' | 'failure',
    workflowName,
    runUrl: workflowRun.html_url,
    repo: repo.repo,
    branch: workflowRun.head_branch,
    duration,
  });

  await postMessage(
    inputs.slackChannel,
    blocks,
    `Workflow ${workflowName} ${conclusion}`
  );

  core.setOutput('notified', 'true');
  core.info(`Workflow "${workflowName}" ${conclusion} notification sent`);
}

// Main entry point
async function main(): Promise<void> {
  try {
    const inputs = getInputs();

    // Validate required inputs
    if (!inputs.eventType) {
      throw new Error('event_type is required');
    }
    if (!inputs.slackToken) {
      throw new Error('slack_token is required');
    }
    if (!inputs.slackChannel) {
      throw new Error('slack_channel is required');
    }
    if (!inputs.githubToken) {
      throw new Error('github_token is required');
    }

    // Initialize clients
    initSlackClient(inputs.slackToken);
    initGitHubClient(inputs.githubToken);

    // Configure git for state management
    const { execSync } = await import('child_process');
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');

    // Handle event
    switch (inputs.eventType) {
      case 'pull_request':
        await handlePullRequest(inputs);
        break;
      case 'issues':
        await handleIssue(inputs);
        break;
      case 'workflow_run':
        await handleWorkflowRun(inputs);
        break;
      case 'summary':
        await runSummary(inputs.slackChannel);
        break;
      default:
        throw new Error(`Unknown event_type: ${inputs.eventType}`);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
    process.exit(1);
  }
}

main();
