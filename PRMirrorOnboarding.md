# Onboarding: PR Mirror Workflow

> **Moved to Confluence.** The canonical onboarding guide now lives at
> **[Mirror Pipeline — PR Mirror Onboarding](https://vyos.atlassian.net/wiki/spaces/VYOS/pages/913735683)**
> (VYOS space, under the GitHub Infrastructure index), maintained alongside the
> rest of the mirror-pipeline documentation.
>
> The previous contents of this file described the retired pre-Rollout-1b/2 model
> (per-wrapper `secrets: PAT`, `permissions: contents: write`, `vyosbot` user
> write access) and are superseded by the current model — central
> `consumers.yaml` inclusion list + uniform canonical wrapper stub + `vyos-bot`
> GitHub App token + `vars.MIRROR_ENABLED` kill-switch. See the Confluence page.
