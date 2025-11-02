import * as core from '@actions/core';
import * as github from '@actions/github';
import { Context } from '@actions/github/lib/context';
import { getOctokit } from '@actions/github';

// Type definitions
type Octokit = ReturnType<typeof getOctokit>;

export interface ActionInputs {
  token: string;
  conflictLabel: string;
  maxRetries: number;
  retryDelay: number;
}

export interface PRCheckingStrategy {
  baseBranchFilter: string | null;
  checkCurrentPROnly: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  base: {
    ref: string;
    sha: string;
  };
  head: {
    ref: string;
    sha: string;
  };
  labels: Array<{ name: string }>;
  mergeable?: boolean | null;
  mergeable_state?: string;
}

export interface PRDetails extends PullRequest {
  mergeable: boolean | null;
  mergeable_state: string;
}

// Constants
export const DEFAULT_CONFLICT_LABEL = 'conflicts';
export const DEFAULT_MAX_RETRIES = 10;
export const DEFAULT_RETRY_DELAY = 5000;
export const DEFAULT_PER_PAGE = 100;

// GitHub event types
export const PULL_REQUEST_EVENTS = ['pull_request', 'pull_request_target'] as const;
export const PR_ACTIONS = {
  SYNCHRONIZE: 'synchronize',
  CLOSED: 'closed'
} as const;

// Mergeable states
export const MERGEABLE_STATES = {
  UNKNOWN: 'unknown',
  DIRTY: 'dirty',
  BEHIND: 'behind'
} as const;

/**
 * GitHub API helper class for PR operations
 */
export class GitHubPRHelper {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(octokit: Octokit, owner: string, repo: string) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
  }

  async fetchOpenPRs(): Promise<PullRequest[]> {
    const { data: pullRequests } = await this.octokit.rest.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: 'open',
      per_page: DEFAULT_PER_PAGE
    });
    return pullRequests as PullRequest[];
  }

  async getPRDetails(prNumber: number): Promise<{ data: PRDetails }> {
    return await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber
    }) as { data: PRDetails };
  }

  async addLabel(prNumber: number, label: string): Promise<void> {
    await this.octokit.rest.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      labels: [label]
    });
  }

  async removeLabel(prNumber: number, label: string): Promise<void> {
    await this.octokit.rest.issues.removeLabel({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      name: label
    });
  }
}

/**
 * Get and validate inputs from the action
 */
export function getInputs(): ActionInputs {
  return {
    token: core.getInput('github-token', { required: true }),
    conflictLabel: core.getInput('conflict-label') || DEFAULT_CONFLICT_LABEL,
    maxRetries: parseInt(core.getInput('max-retries') || DEFAULT_MAX_RETRIES.toString(), 10),
    retryDelay: parseInt(core.getInput('retry-delay') || DEFAULT_RETRY_DELAY.toString(), 10)
  };
}

/**
 * Log context information for debugging
 */
function logContext(context: Context, owner: string, repo: string): void {
  core.info(`Checking repository: ${owner}/${repo}`);
  core.info(`Event: ${context.eventName}`);
  core.info(`Action: ${context.payload.action || 'N/A'}`);
}

/**
 * Determine PR filtering strategy based on trigger event
 */
export function determinePRCheckingStrategy(context: Context): PRCheckingStrategy {
  let baseBranchFilter: string | null = null;
  let checkCurrentPROnly = false;

  if (PULL_REQUEST_EVENTS.includes(context.eventName as typeof PULL_REQUEST_EVENTS[number])) {
    const action = context.payload.action;
    baseBranchFilter = context.payload.pull_request?.base?.ref || null;

    if (action === PR_ACTIONS.SYNCHRONIZE) {
      checkCurrentPROnly = true;
      core.info(`PR ${action} - checking only current PR #${context.payload.pull_request?.number}`);
    } else if (action === PR_ACTIONS.CLOSED && context.payload.pull_request?.merged) {
      core.info(`PR merged - checking all PRs targeting base branch: ${baseBranchFilter}`);
    }
  } else {
    core.info(`Non-PR trigger - checking all open PRs regardless of base branch`);
  }

  return { baseBranchFilter, checkCurrentPROnly };
}

/**
 * Get current PR for synchronize events
 */
export function getCurrentPR(context: Context): PullRequest {
  const currentPR = context.payload.pull_request;
  if (!currentPR) {
    throw new Error('No pull request found in context payload');
  }
  
  return {
    number: currentPR.number,
    title: currentPR.title,
    base: currentPR.base,
    head: currentPR.head,
    labels: currentPR.labels || []
  };
}

/**
 * Filter PRs based on base branch
 */
export function filterPRsByBaseBranch(pullRequests: PullRequest[], baseBranchFilter: string | null): PullRequest[] {
  if (!baseBranchFilter) {
    return pullRequests;
  }
  return pullRequests.filter(pr => pr.base.ref === baseBranchFilter);
}

/**
 * Get PRs to check based on trigger type and filtering strategy
 */
async function getPRsToCheck(
  githubHelper: GitHubPRHelper, 
  context: Context, 
  checkCurrentPROnly: boolean, 
  baseBranchFilter: string | null
): Promise<PullRequest[]> {
  if (checkCurrentPROnly) {
    const currentPR = getCurrentPR(context);
    core.info(`Checking only current PR #${currentPR.number}: ${currentPR.title}`);
    return [currentPR];
  }

  const allPRs = await githubHelper.fetchOpenPRs();
  const filteredPRs = filterPRsByBaseBranch(allPRs, baseBranchFilter);

  if (baseBranchFilter) {
    core.info(`Filtered to ${filteredPRs.length} PRs targeting base branch '${baseBranchFilter}' (out of ${allPRs.length} total open PRs)`);
  } else {
    core.info(`Found ${allPRs.length} open pull requests (checking all branches)`);
  }

  return filteredPRs;
}

/**
 * Wait for GitHub to calculate mergeable state with retries
 */
async function waitForMergeableState(
  githubHelper: GitHubPRHelper, 
  prNumber: number, 
  maxRetries: number, 
  retryDelay: number
): Promise<PRDetails> {
  let prDetails = await githubHelper.getPRDetails(prNumber);

  let retries = 0;
  while (prDetails.data.mergeable_state === MERGEABLE_STATES.UNKNOWN && retries < maxRetries) {
    core.info(`  Waiting for mergeable state... (attempt ${retries + 1})`);
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    prDetails = await githubHelper.getPRDetails(prNumber);
    retries++;
  }

  return prDetails.data;
}

/**
 * Check if PR has conflicts based on mergeable state
 */
export function hasConflicts(mergeable: boolean | null, mergeableState: string): boolean {
  return mergeable === false && (mergeableState === MERGEABLE_STATES.DIRTY || mergeableState === MERGEABLE_STATES.BEHIND);
}

/**
 * Add conflict label to PR
 */
async function addConflictLabel(githubHelper: GitHubPRHelper, prNumber: number, conflictLabel: string): Promise<void> {
  await githubHelper.addLabel(prNumber, conflictLabel);
  core.info(`  ✅ Added ${conflictLabel} label to PR #${prNumber}`);
}

/**
 * Remove conflict label from PR
 */
async function removeConflictLabel(githubHelper: GitHubPRHelper, prNumber: number, conflictLabel: string): Promise<void> {
  try {
    await githubHelper.removeLabel(prNumber, conflictLabel);
    core.info(`  ✅ Removed ${conflictLabel} label from PR #${prNumber}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    core.warning(`  ⚠️  Could not remove label: ${errorMessage}`);
  }
}

/**
 * Process a single PR for conflict checking and label management
 */
async function processPR(
  githubHelper: GitHubPRHelper, 
  pr: PullRequest, 
  conflictLabel: string, 
  maxRetries: number, 
  retryDelay: number
): Promise<void> {
  core.info(`\nChecking PR #${pr.number}: ${pr.title}`);

  const prDetails = await waitForMergeableState(githubHelper, pr.number, maxRetries, retryDelay);
  const { mergeable, mergeable_state } = prDetails;
  const currentLabels = prDetails.labels.map(label => label.name);
  const hasConflictsLabel = currentLabels.includes(conflictLabel);
  const prHasConflicts = hasConflicts(mergeable, mergeable_state);

  core.info(`  Mergeable: ${mergeable}, State: ${mergeable_state}`);
  core.info(`  Has conflicts: ${prHasConflicts}, Has label: ${hasConflictsLabel}`);

  if (prHasConflicts && !hasConflictsLabel) {
    await addConflictLabel(githubHelper, pr.number, conflictLabel);
  } else if (!prHasConflicts && hasConflictsLabel) {
    await removeConflictLabel(githubHelper, pr.number, conflictLabel);
  } else {
    core.info(`  ℹ️  No label changes needed for PR #${pr.number}`);
  }
}

/**
 * Main function to run the conflict checking action
 */
export async function run(): Promise<void> {
  try {
    const inputs = getInputs();
    const octokit = github.getOctokit(inputs.token);
    const context = github.context;
    const { owner, repo } = context.repo;

    // Initialize GitHub helper
    const githubHelper = new GitHubPRHelper(octokit, owner, repo);

    logContext(context, owner, repo);

    const { baseBranchFilter, checkCurrentPROnly } = determinePRCheckingStrategy(context);
    const prsToCheck = await getPRsToCheck(githubHelper, context, checkCurrentPROnly, baseBranchFilter);

    // Process each PR
    for (const pr of prsToCheck) {
      try {
        await processPR(githubHelper, pr, inputs.conflictLabel, inputs.maxRetries, inputs.retryDelay);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        core.error(`  ❌ Error processing PR #${pr.number}: ${errorMessage}`);
      }
    }

    core.info('✅ Conflict checking completed successfully');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

// Run the action
run().catch(error => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  core.setFailed(`Action failed: ${errorMessage}`);
});