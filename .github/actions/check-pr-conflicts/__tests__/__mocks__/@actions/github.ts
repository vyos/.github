export const getOctokit = jest.fn();

export let context = {
  eventName: 'pull_request',
  payload: {},
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  sha: 'abc123',
  ref: 'refs/heads/main',
  workflow: 'test-workflow',
  action: 'test-action',
  actor: 'test-actor',
  job: 'test-job',
  runNumber: 1,
  runId: 1,
};