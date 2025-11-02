import {
  getInputs,
  determinePRCheckingStrategy,
  filterPRsByBaseBranch,
  hasConflicts,
  GitHubPRHelper,
  run,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY,
  MERGEABLE_STATES,
} from '../src/index';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { createMockContext, createMockOctokit, createMockPR } from './test-utils';

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/github');

const mockCore = core as jest.Mocked<typeof core>;
const mockGithub = github as jest.Mocked<typeof github>;

describe('Check PR Conflicts Action', () => {
  let mockOctokit: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOctokit = createMockOctokit();
    mockGithub.getOctokit.mockReturnValue(mockOctokit);
  });

  describe('Input Processing', () => {
    test('should handle input validation and defaults', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return 'test-token';
        if (name === 'conflict-label') return 'custom-conflicts';
        if (name === 'max-retries') return '';  // Empty string should use default
        return '';
      });

      const inputs = getInputs();

      expect(inputs).toEqual({
        token: 'test-token',
        conflictLabel: 'custom-conflicts',
        maxRetries: DEFAULT_MAX_RETRIES,
        retryDelay: DEFAULT_RETRY_DELAY,
      });
    });
  });

  describe('PR Strategy Determination', () => {
    test('should determine correct checking strategy for different events', () => {
      // PR synchronize - check current PR only
      const syncContext = createMockContext({
        eventName: 'pull_request',
        payload: {
          action: 'synchronize',
          pull_request: { number: 123, base: { ref: 'main' } },
        },
      });
      expect(determinePRCheckingStrategy(syncContext)).toEqual({
        baseBranchFilter: 'main',
        checkCurrentPROnly: true,
      });

      // PR merged - check all PRs targeting base
      const mergedContext = createMockContext({
        eventName: 'pull_request',
        payload: {
          action: 'closed',
          pull_request: { number: 456, base: { ref: 'main' }, merged: true },
        },
      });
      expect(determinePRCheckingStrategy(mergedContext)).toEqual({
        baseBranchFilter: 'main',
        checkCurrentPROnly: false,
      });

      // Schedule event - check all PRs
      const scheduleContext = createMockContext({ eventName: 'schedule' });
      expect(determinePRCheckingStrategy(scheduleContext)).toEqual({
        baseBranchFilter: null,
        checkCurrentPROnly: false,
      });
    });
  });

  describe('Conflict Detection', () => {
    test('should correctly identify conflicts based on mergeable state', () => {
      // Has conflicts
      expect(hasConflicts(false, MERGEABLE_STATES.DIRTY)).toBe(true);
      expect(hasConflicts(false, MERGEABLE_STATES.BEHIND)).toBe(true);

      // No conflicts
      expect(hasConflicts(true, MERGEABLE_STATES.DIRTY)).toBe(false);
      expect(hasConflicts(null, MERGEABLE_STATES.DIRTY)).toBe(false);
      expect(hasConflicts(false, 'clean')).toBe(false);
      expect(hasConflicts(false, MERGEABLE_STATES.UNKNOWN)).toBe(false);
    });
  });

  describe('PR Filtering', () => {
    test('should filter PRs by base branch when specified', () => {
      const prs = [
        createMockPR({ number: 1, base: { ref: 'main' } }),
        createMockPR({ number: 2, base: { ref: 'develop' } }),
        createMockPR({ number: 3, base: { ref: 'main' } }),
      ];

      expect(filterPRsByBaseBranch(prs, 'main')).toHaveLength(2);
      expect(filterPRsByBaseBranch(prs, null)).toHaveLength(3);
      expect(filterPRsByBaseBranch([], 'main')).toHaveLength(0);
    });
  });

  describe('GitHub API Integration', () => {
    test('should handle PR operations correctly', async () => {
      const helper = new GitHubPRHelper(mockOctokit, 'owner', 'repo');
      
      // Test fetchOpenPRs
      const mockPRs = [createMockPR(), createMockPR({ number: 2 })];
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: mockPRs });
      
      const prs = await helper.fetchOpenPRs();
      
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        state: 'open',
        per_page: 100,
      });
      expect(prs).toEqual(mockPRs);

      // Test label operations
      await helper.addLabel(123, 'conflicts');
      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        labels: ['conflicts'],
      });
    });
  });

  describe('End-to-End Scenarios', () => {
    beforeEach(() => {
      mockCore.getInput.mockImplementation((name: string) => {
        switch (name) {
          case 'github-token': return 'test-token';
          case 'conflict-label': return 'conflicts';
          case 'max-retries': return '2';
          case 'retry-delay': return '100';
          default: return '';
        }
      });
    });

    test('should handle PR with conflicts', async () => {
      const context = createMockContext({
        eventName: 'pull_request',
        payload: {
          action: 'synchronize',
          pull_request: {
            number: 123,
            title: 'Test PR',
            base: { ref: 'main' },
            head: { ref: 'feature' },
            labels: [],
          },
        },
      });
      (mockGithub.context as any) = context;

      // Mock PR with conflicts
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: createMockPR({
          number: 123,
          mergeable: false,
          mergeable_state: 'dirty',
          labels: [],
        }),
      });

      await run();

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 123,
        labels: ['conflicts'],
      });
      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });

    test('should handle PR without conflicts', async () => {
      const context = createMockContext({
        eventName: 'pull_request',
        payload: {
          action: 'synchronize',
          pull_request: {
            number: 123,
            labels: [{ name: 'conflicts' }],
          },
        },
      });
      (mockGithub.context as any) = context;

      // Mock PR without conflicts
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: createMockPR({
          number: 123,
          mergeable: true,
          mergeable_state: 'clean',
          labels: [{ name: 'conflicts' }],
        }),
      });

      await run();

      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 123,
        name: 'conflicts',
      });
    });

    test('should handle multiple PRs on schedule event', async () => {
      const context = createMockContext({ eventName: 'schedule' });
      (mockGithub.context as any) = context;

      // Mock multiple PRs
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          createMockPR({ number: 1, mergeable: true }),
          createMockPR({ number: 2, mergeable: false, mergeable_state: 'dirty' }),
        ],
      });

      mockOctokit.rest.pulls.get
        .mockResolvedValueOnce({ data: createMockPR({ number: 1, mergeable: true }) })
        .mockResolvedValueOnce({ data: createMockPR({ number: 2, mergeable: false, mergeable_state: 'dirty' }) });

      await run();

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledTimes(2);
    });

    test('should handle missing token gracefully', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') throw new Error('Token required');
        return '';
      });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('Action failed: Token required');
    });
  });
});