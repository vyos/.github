#!/usr/bin/env bash
# reconcile-rolling.sh — make target <branch> reflect source <branch>, backing up
# divergent target work first. Shared by Part A (INITIAL) and Part B (GUARD).
#
# Usage: reconcile-rolling.sh <source_repo> <target_repo> <branch> <mode> <ts>
#   mode = INITIAL | GUARD | CLASSIFY
#     CLASSIFY = read-only; print "case1|case2|case3|unrelated" + S/T/MB; never push. (A3 dry-run)
#   ts   = timestamp string for the backup branch name (caller supplies; e.g. run id)
# Env: GH_TOKEN_SOURCE, GH_TOKEN_TARGET (App installation tokens)
#   CUTOFF_SHA (INITIAL only, optional) — if set, S is PINNED to this value (the freeze
#     cutoff) instead of live source HEAD, and the script asserts live source HEAD == CUTOFF_SHA
#     before any push (freeze-violation guard, spec §5). Abort exit 10 on mismatch.
# Exit: 0 = reconciled or no-op (or CLASSIFY printed); 10 = aborted (backup failed /
#       unrelated history / lease failure exhausted / force-push rejected / freeze violated)
#       — caller must NOT proceed to mirror.
set -euo pipefail

SRC="$1"; TGT="$2"; BR="$3"; MODE="$4"; TS="${5:-}"
[ "$BR" = "rolling" ] || { echo "::error::reconcile-rolling: refusing non-rolling branch '$BR'"; exit 10; }
case "$MODE" in INITIAL|GUARD|CLASSIFY) ;; *) echo "::error::bad mode '$MODE'"; exit 10;; esac

api() { gh api "$@"; }   # gh respects GH_TOKEN; we set per-call below

# Read SHAs via API (no full clone needed for classification)
S_LIVE=$(GH_TOKEN="$GH_TOKEN_SOURCE" api "repos/$SRC/git/ref/heads/$BR" --jq .object.sha 2>/dev/null || echo "")
T=$(GH_TOKEN="$GH_TOKEN_TARGET" api "repos/$TGT/git/ref/heads/$BR" --jq .object.sha 2>/dev/null || echo "")
[ -n "$S_LIVE" ] || { echo "::error::source $SRC@$BR has no rolling ref"; exit 10; }
[ -n "$T" ] || { echo "::error::target $TGT@$BR has no rolling ref"; exit 10; }

# Freeze-cutoff pin (INITIAL only): S is the cutoff, and live source must still equal it.
if [ "$MODE" = "INITIAL" ] && [ -n "${CUTOFF_SHA:-}" ]; then
  [ "$S_LIVE" = "$CUTOFF_SHA" ] || { echo "::error::freeze violated: live source HEAD $S_LIVE != cutoff $CUTOFF_SHA for $SRC; abort"; exit 10; }
  S="$CUTOFF_SHA"
else
  S="$S_LIVE"
fi

# Case 1: identical
if [ "$S" = "$T" ]; then
  echo "reconcile: $TGT@$BR == source ($S); no-op"
  [ "$MODE" = "CLASSIFY" ] && echo "case1 S=$S T=$T MB=$S"
  echo "reconcile_action=noop"
  exit 0
fi

# Full-depth clone of source; add target remote; fetch both (lease baseline + ancestry)
work="$(mktemp -d)"; trap 'rm -rf "$work" 2>/dev/null || true' EXIT
git clone --quiet "https://x-access-token:$GH_TOKEN_SOURCE@github.com/$SRC.git" "$work/src"
cd "$work/src"
git remote add target "https://x-access-token:$GH_TOKEN_TARGET@github.com/$TGT.git"
# explicit destination refspecs so refs/remotes/{origin,target}/$BR exist for merge-base
# (a bare `git fetch <remote> <branch>` may only write FETCH_HEAD — Codex round-5 finding)
git fetch --quiet target "$BR:refs/remotes/target/$BR"
git fetch --quiet origin "$BR:refs/remotes/origin/$BR"

# Shared-root assertion (unrelated histories = sibling repo; never push)
if ! git merge-base "$S" "$T" >/dev/null 2>&1; then
  echo "::error::reconcile: $SRC and $TGT have UNRELATED histories (sibling repo?); refusing force-push"
  [ "$MODE" = "CLASSIFY" ] && { echo "unrelated S=$S T=$T MB=none"; exit 0; }
  exit 10
fi
MB="$(git merge-base "$S" "$T")"

# CLASSIFY: print the case and exit without any push
if [ "$MODE" = "CLASSIFY" ]; then
  if git merge-base --is-ancestor "$T" "$S"; then echo "case2 S=$S T=$T MB=$MB";
  else echo "case3 S=$S T=$T MB=$MB"; fi
  exit 0
fi

# Case 2: target is ancestor of source (behind, no unique target work)
if git merge-base --is-ancestor "$T" "$S"; then
  if [ "$MODE" = "INITIAL" ]; then
    if ! git push target "$S:refs/heads/$BR" --force-with-lease="refs/heads/$BR:$T"; then
      echo "::error::reconcile(INITIAL): case-2 fast-forward lease/push failed for $TGT (target moved or ruleset reject); abort"; exit 10
    fi
    echo "reconcile: $TGT@$BR fast-forwarded to source $S"
  else
    echo "reconcile(GUARD): $TGT@$BR behind source; no-op (per-PR loop advances it)"
  fi
  echo "reconcile_action=noop"
  exit 0
fi

# Case 3: diverged (target has commits not in source)
# backup-then-push, with one lease-retry on a racing target push (spec §7).
attempt=0
while :; do
  BACKUP="backup/pre-mirror-reconcile-${TS}-a${attempt}-${T:0:8}"
  # atomic backup; reuse if already at T; never overwrite a backup pointing elsewhere
  if existing=$(GH_TOKEN="$GH_TOKEN_TARGET" api "repos/$TGT/git/ref/heads/$BACKUP" --jq .object.sha 2>/dev/null); then
    [ "$existing" = "$T" ] || { echo "::error::backup ref $BACKUP exists but != T; abort"; exit 10; }
  else
    GH_TOKEN="$GH_TOKEN_TARGET" api -X POST "repos/$TGT/git/refs" \
      -f ref="refs/heads/$BACKUP" -f sha="$T" >/dev/null \
      || { echo "::error::reconcile: BACKUP creation failed for $TGT ($BACKUP @ $T); refusing force-push"; exit 10; }
  fi
  verify=$(GH_TOKEN="$GH_TOKEN_TARGET" api "repos/$TGT/git/ref/heads/$BACKUP" --jq .object.sha)
  [ "$verify" = "$T" ] || { echo "::error::reconcile: backup verify mismatch; abort"; exit 10; }

  if [ "$MODE" = "INITIAL" ]; then RESET="$S"; else RESET="$MB"; fi
  if git push target "$RESET:refs/heads/$BR" --force-with-lease="refs/heads/$BR:$T"; then
    echo "::warning::$TGT@$BR diverged; backed up T=$T to $BACKUP; reset to ${MODE}-point $RESET"
    echo "reconcile_action=reset"   # case-3 signal — OBSERVABILITY ONLY (round-5: replay no longer gated on it)
    exit 0
  fi
  # lease failed → target advanced T→U during the window. Re-read, fresh backup at U,
  # retry ONCE. Keep the prior backup ref (never delete on retry). (spec §7)
  if [ "$attempt" -ge 1 ]; then
    echo "::error::reconcile: force-push lease failed twice for $TGT (backups preserved); abort"; exit 10
  fi
  attempt=1
  # FORCED refspec (+): refs/remotes/target/$BR already exists from the initial fetch and the
  # target advanced T->U; a non-forced fetch can fail to update the local ref (round-5 Codex minor).
  git fetch --quiet target "+$BR:refs/remotes/target/$BR"
  newT=$(GH_TOKEN="$GH_TOKEN_TARGET" api "repos/$TGT/git/ref/heads/$BR" --jq .object.sha)
  [ "$newT" != "$T" ] || { echo "::error::reconcile: lease failed but target HEAD unchanged ($T); ruleset/bypass reject — abort"; exit 10; }
  T="$newT"
  # re-assert shared root + recompute MB against the new T before retry
  git merge-base "$S" "$T" >/dev/null 2>&1 || { echo "::error::reconcile: new target HEAD unrelated to source; abort"; exit 10; }
  MB="$(git merge-base "$S" "$T")"
done
