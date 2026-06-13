# AGENTS.md

## Project purpose

Org-wide community-health repo for the `vyos` GitHub organisation. Hosts the canonical reusable GitHub Actions workflows (`workflow_call`) consumed by every `vyos/*` repo, plus PR-validation, doc-linter, typo-checker, and XML preprocessor scripts. Default branch is `production`; changes ship to all consumers immediately — no semver, no release process.

## Tech stack

- GitHub Actions YAML (18 reusable `workflow_call` workflows + 1 regular workflow (`cla-check.yml`) under `.github/workflows/`).
- Python helpers (`scripts/check-pr-conflicts.py`, `scripts/process-typos.py`, `.github/doc-linter.py`, `scripts/override-default`, `scripts/transclude-template`).
- Minimal Python deps in `scripts/requirements.txt` (`requests>=2.32.0,<3.0.0`); `lxml` is pulled by consumer repos for the XML preprocessors.
- Shell helper (`scripts/check-typos.sh`) wrapping the `typos` CLI.

## Build / test / run

No build system, test suite, or lockfile. To exercise a workflow before merging, call it from a consumer repo pinned to a feature branch (`uses: vyos/.github/.github/workflows/<name>.yml@<branch>`). `check-pr-merge-conflict.yml` accepts an `action-ref` input for this.

```
pip install -r scripts/requirements.txt
GITHUB_TOKEN=... GITHUB_REPOSITORY=vyos/.github GITHUB_EVENT_NAME=schedule \
  python scripts/check-pr-conflicts.py
python.github/doc-linter.py "['path/to/file.rst']"
python scripts/override-default <xml-dir>
python scripts/transclude-template <file.xml>
```

## Repository layout

- `.github/workflows/` — reusable workflows: staleness (`check-stale`), PR validation (`check-pr-merge-conflict`), linting (`lint-doc`, `lint-j2`, `lint-with-ruff`, `lint-with-darker-ruff`, `check-unused-imports`, `check-typos`), security (`codeql-analysis`), CLA (`cla-check`), package rebuilds (`trigger-rebuild-repo-package`, `trigger-and-wait-rebuild-repo-package`), mirror (`pr-mirror-repo-sync`). PR labeling, author-assign, title/commit-format, and base-branch conflict labeling moved to central Mergify rules in `vyos/mergify` (T8937 retirement). `check-pr-merge-conflict` is preserved — it covers the committed-conflict-marker case (T8934) that Mergify's `conflict` predicate cannot.
- `.github/doc-linter.py` — RST/TXT linter (RFC 5737/3849 IPs, ≤80-char lines, `.. stop_vyoslinter` toggles).
- `.github/.typos.toml` — default `typos` config; excludes `smoketest/**`, `mibs/**`.
- `scripts/` — helpers (Python + shell).
- `profile/README.md` — rendered as the `vyos` org landing page.
- `CODEOWNERS`, `CONTRIBUTING.md`, `PRMirrorOnboarding.md`.

## Cross-repo context

This repo is the canonical workflow library for both orgs. Consumers reference workflows as `uses: vyos/.github/.github/workflows/<name>.yml@production` with no version pin. The mirror pipeline (`pr-mirror-repo-sync.yml`) is currently live for `vyos-1x`, `vyos-build`, `vyos-utils`, and `vyos1x-config`. `vyos/vyos-cla-signatures` provides the CLA reusable. `vyos-documentation` consumes `lint-doc.yml` (which runs `.github/doc-linter.py`).

## Conventions

- Commit / PR title format: `component: T12345: description`. Phorge task ID at https://vyos.dev mandatory. Enforced by Mergify merge protections (per-product-repo `invalid-task-id` rule + central `invalid-title`/`invalid-body`, T8966).
- This repo's own default branch is `production` (renamed from `current` in rollout 1c). Release-train branch model (in consumer repos, labeled by central Mergify base-branch rules): `rolling` (renamed from `current`), `circinus` (1.5 LTS), `sagitta` (1.4 LTS), `equuleus` (1.3 LTS).
- Backports: `@Mergifyio backport <branch>` (built-in Mergify command). The mirror pipeline injects these from `bp/<branch>` source labels.
- Workflows here must be reusable (`workflow_call`); avoid adding non-reusable workflows unless necessary (the only current exception is `cla-check.yml`, which uses `pull_request_target`).
- Most jobs include a `bullfrogsec/bullfrog@v0.8.4` egress-audit step (non-fatal).
- Bot identity for cross-org mutations: `vyosbot` via org-level `PAT` and `REMOTE_OWNER` secrets.

## Notes for future contributors

- Any change merged to `production` ships to every consumer immediately. Test from a feature branch first via `uses:...@<branch>`.
- Onboarding a repo to the mirror pipeline: see `PRMirrorOnboarding.md`.
- Architecture & cross-org drift inventory: Confluence 792723546. GHA security hardening spec: 795344927. GHE baseline audit: 795967489.
- This file (`CLAUDE.md`) is the authoritative working document for AI agents and contributors; keep it updated when conventions or layout change.
