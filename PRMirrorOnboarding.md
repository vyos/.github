# Onboarding: PR Mirror Workflow

The **PR Mirror and Repo Sync** pipeline copies merged pull requests from a
public `vyos/<repo>` source to its private `VyOS-Networks/<repo>` twin. As of
**Rollout 2** (inclusion mechanism + uniform wrappers) onboarding is a
**two-step** process:

1. Add the repo to the authoritative inclusion list
   (`VyOS-Networks/.github/mirror/consumers.yaml`).
2. Commit the canonical wrapper stub to the source repo.

Both steps are required. A wrapper without a `consumers.yaml` entry is inert
(the central workflow short-circuits with the `mirror-skipped` label); an entry
without a wrapper never triggers.

## 1. Add an entry to `consumers.yaml`

The authoritative inclusion list lives at
**`VyOS-Networks/.github/mirror/consumers.yaml`** (private — kept off public
surfaces so consumer enumeration and per-repo config aren't exposed). Add one
entry per source→target pair:

```yaml
  - source: vyos/<repo>
    target: VyOS-Networks/<repo>
    sync_branches: [rolling]        # the consumer's default branch post-1c
```

Use `[production]` instead of `[rolling]` for the rare non-release-train
consumer whose default branch is `production`.

**Access caveat — who can edit `consumers.yaml`:** the repo is private. Edits
require write access to `VyOS-Networks/.github`, held by the
**`vyos/github-infrastructure-maintainers`** team. Operators without that access
should request the change in the **`#vyos-infra`** Slack channel and tag a team
member. (Verify the team name and channel are still current at PR time:
`gh api orgs/vyos/teams/github-infrastructure-maintainers/members --jq '.[].login'`.)

## 2. Add the canonical wrapper stub to the source repo

Create the file at `vyos/<repo>/.github/workflows/pr-mirror-repo-sync.yml` with
the **canonical uniform stub** below, byte-for-byte. Do not customize it — the
stub is intentionally identical across every consumer so the fleet can be
audited and updated mechanically.

```yaml
# .github/workflows/pr-mirror-repo-sync.yml
# DO NOT EDIT — managed by mirror-pipeline rollout.
# To opt out: set vars.MIRROR_ENABLED=false in this repo's Actions variables.
name: PR Mirror and Repo Sync

on:
  pull_request_target:
    types: [closed]
    branches: [rolling, production]
  workflow_dispatch:
    inputs:
      sync_branch:
        required: true
        type: string

permissions:
  contents: read

jobs:
  call:
    if: |
      github.repository_owner == 'vyos'
      && (github.event.pull_request.merged == true || github.event_name == 'workflow_dispatch')
    uses: vyos/.github/.github/workflows/pr-mirror-repo-sync.yml@production
    with:
      sync_branch: ${{ inputs.sync_branch || github.event.pull_request.base.ref }}
    secrets: inherit
```

Notes on the stub (all load-bearing — do not change):

- **`permissions: contents: read`** — the wrapper's own `GITHUB_TOKEN` is *not*
  used for mirror writes. All target-side writes are performed by the
  **`vyos-bot` GitHub App** token minted inside the central reusable workflow
  (`vyos/.github/.github/actions/get-token`). The wrapper needs only read access.
- **`secrets: inherit`** — the reusable workflow reads org-level secrets/vars
  (the App private key, `REMOTE_OWNER`) directly; there is no longer a
  per-wrapper `secrets: PAT` block. The legacy `vyosbot` *user* PAT model is
  retired.
- **`@production`** — the reusable is pinned to the `vyos/.github` default
  branch (renamed `current`→`production` in Rollout 1c).
- **`branches: [rolling, production]`** — covers both default-branch shapes in
  the fleet.

## 3. Kill-switch — `vars.MIRROR_ENABLED`

To temporarily disable mirroring for a consumer without removing it from
`consumers.yaml` or deleting the wrapper, set an Actions **variable** (not a
secret) on the source repo:

```bash
gh variable set MIRROR_ENABLED --body "false" --repo vyos/<repo>
```

The central workflow re-checks `MIRROR_ENABLED` immediately before every
side-effecting operation, so flipping it mid-run is safe. Restore mirroring by
deleting the variable (absence = enabled):

```bash
gh variable delete MIRROR_ENABLED --repo vyos/<repo>
```

## 4. Source-PR label state machine

The central workflow labels the **source** PR to record mirror state:

| Label | Meaning |
|-------|---------|
| `mirror-initiated` | Mirror run started for this PR. |
| `mirror-completed` | Mirror PR created on the twin and merged. |
| `mirror-skipped`   | Repo not in `consumers.yaml`, or `vars.MIRROR_ENABLED=false`. No target-side effects. |
| `mirror-failed`    | Mirror run errored (e.g. cherry-pick conflict on the twin). Needs manual reconciliation. |

## 5. Canary / central-workflow changes — cross-repo ref matching

When canarying a change to the **central** workflow on a feature branch of
`vyos/.github`, the same-named feature branch must also exist on
`VyOS-Networks/.github` (the `consumers.yaml` lookup resolves against the
calling ref). If it's missing, the central workflow's canary-typo guard fails
the run **loud** rather than silently falling back to `production`. Create the
matching branch on `VyOS-Networks/.github` before dispatching the canary.

## Offboarding

Remove the `consumers.yaml` entry first (the wrapper becomes inert immediately —
`mirror-skipped`), then delete the wrapper file from the source repo on a
follow-up sweep.
