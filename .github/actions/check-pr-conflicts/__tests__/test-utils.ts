import { Context } from '@actions/github/lib/context';

/**
 * Mock GitHub context factory for testing
 */
export function createMockContext(overrides: Partial<Context> = {}): Context {
  const defaultContext: Partial<Context> = {
    eventName: 'pull_request',
    payload: {
      action: 'synchronize',
      pull_request: {
        number: 123,
        title: 'Test PR',
        base: { ref: 'main', sha: 'abc123' },
        head: { ref: 'feature', sha: 'def456' },
        labels: [],
        merged: false,
      },
    },
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
    sha: 'abc123',
    ref: 'refs/heads/feature',
    workflow: 'test-workflow',
    action: 'test-action',
    actor: 'test-actor',
    job: 'test-job',
    runNumber: 1,
    runId: 1,
  };

  return { ...defaultContext, ...overrides } as Context;
}

/**
 * Mock Octokit instance for testing
 */
export function createMockOctokit() {
  return {
    rest: {
      pulls: {
        list: jest.fn(),
        get: jest.fn(),
      },
      issues: {
        addLabels: jest.fn(),
        removeLabel: jest.fn(),
      },
    },
  };
}

/**
 * Mock pull request data for testing
 */
export function createMockPR(overrides: any = {}) {
  return {
    number: 123,
    title: 'Test PR',
    base: { ref: 'main', sha: 'abc123' },
    head: { ref: 'feature', sha: 'def456' },
    labels: [],
    mergeable: true,
    mergeable_state: 'clean',
    ...overrides,
  };
}