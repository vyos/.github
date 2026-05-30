# Onboarding: PR Mirror Workflow

Follow these steps to onboard a repository to the **PR Mirror and Repo Sync** workflow.

## 1. Add the Workflow File

- Create the workflow file at:  
```
vyos/$REPO/.github/workflows/pr-mirror-repo-sync.yml
```
Use the following workflow definition:

```yaml
name: PR Mirror and Repo Sync

on:
  pull_request_target:
    types: [closed]
    branches: [rolling]
  workflow_dispatch:
    inputs:
      sync_branch:
        description: 'Branch to mirror'
        required: true
        default: 'rolling'
        type: choice
        options:
          - rolling

permissions:
  pull-requests: write
  contents: write
  issues: write

jobs:
  call-pr-mirror-repo-sync:
    if: |
      github.repository_owner == 'vyos' &&
      (
        github.event_name == 'workflow_dispatch' ||
        (github.event_name == 'pull_request_target' && github.event.pull_request.merged == true)
      )
    uses: vyos/.github/.github/workflows/pr-mirror-repo-sync.yml@production
    with:
      sync_branch: ${{ github.event.inputs.sync_branch || 'rolling' }}
    secrets:
      PAT: ${{ secrets.PAT }}
      REMOTE_OWNER: ${{ secrets.REMOTE_OWNER }}
```
## 2. Configure Required Secrets Access for Source Repository

- In the **source repository** (`vyos/$REPO`), ensure it has access to the following organization secrets:  
  - `PAT`  
  - `REMOTE_OWNER`

## 3. Grant `vyosbot` Access

- Provide **write** access for the `vyosbot` user to both **source** and **target** repositories (`vyos/$REPO` and `$REMOTE_OWNER/$REPO`)

- In the **target repository** (`$REMOTE_OWNER/$REPO`) branch protection settings, For the mirror branch (ex: `rolling`)
  - Under **Restrict who can push to matching branches** (Restrict pushes that create matching branches), add `vyosbot`.  
  - Under **Allow force pushes**, add `vyosbot`.