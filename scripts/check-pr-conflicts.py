#!/usr/bin/env python3
"""
Check PR conflicts and manage conflict labels.

This script checks pull requests for merge conflicts and automatically
adds/removes a conflict label based on the mergeable state and detection
of conflict markers in the PR diff (for Mergify backport PRs).
"""

import os
import sys
import time
import json
import subprocess
import re
from typing import List, Dict, Optional, Any
from enum import Enum

try:
    import requests
except ImportError:
    print("Error: requests module not found. Install with: pip install requests")
    sys.exit(1)

# Constants
DEFAULT_CONFLICT_LABEL = "conflicts"
DEFAULT_MAX_RETRIES = 10
DEFAULT_RETRY_DELAY = 5  # seconds
DEFAULT_PER_PAGE = 100

PULL_REQUEST_EVENTS = ["pull_request", "pull_request_target"]
MERGEABLE_STATES = {
    "UNKNOWN": "unknown",
    "DIRTY": "dirty",
    "CLEAN": "clean",
    "BLOCKED": "blocked",
    "UNSTABLE": "unstable",
    "BEHIND": "behind"
}


class PRCheckingStrategy(Enum):
    """Strategy for determining which PRs to check."""
    CHECK_CURRENT_PR_ONLY = "check_current_pr"  # Check only the current PR (on synchronize)
    CHECK_BASE_BRANCH_PRS = "check_base_branch_prs"  # Check PRs targeting specific base branch (on merge)
    CHECK_ALL_PRS = "check_all_prs"  # Check all open PRs (scheduled/other events)


class GitHubAPI:
    """Helper class for GitHub API operations."""

    def __init__(self, token: str, owner: str, repo: str):
        self.token = token
        self.owner = owner
        self.repo = repo
        self.base_url = "https://api.github.com"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }

    def _request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Make a request to GitHub API."""
        url = f"{self.base_url}{endpoint}"
        response = requests.request(method, url, headers=self.headers, **kwargs)
        response.raise_for_status()
        return response

    def fetch_open_prs(self) -> List[Dict[str, Any]]:
        """Fetch all open pull requests with pagination support."""
        endpoint = f"/repos/{self.owner}/{self.repo}/pulls"
        params = {"state": "open", "per_page": DEFAULT_PER_PAGE}
        all_prs = []
        page = 1
        
        while True:
            params["page"] = page
            response = self._request("GET", endpoint, params=params)
            prs = response.json()
            if not prs:
                break
            all_prs.extend(prs)
            page += 1
        
        return all_prs

    def get_pr_details(self, pr_number: int) -> Dict[str, Any]:
        """Get detailed information about a PR."""
        endpoint = f"/repos/{self.owner}/{self.repo}/pulls/{pr_number}"
        response = self._request("GET", endpoint)
        return response.json()

    def add_label(self, pr_number: int, label: str) -> None:
        """Add a label to a PR."""
        endpoint = f"/repos/{self.owner}/{self.repo}/issues/{pr_number}/labels"
        self._request("POST", endpoint, json={"labels": [label]})

    def remove_label(self, pr_number: int, label: str) -> None:
        """Remove a label from a PR."""
        endpoint = f"/repos/{self.owner}/{self.repo}/issues/{pr_number}/labels/{label}"
        self._request("DELETE", endpoint)


def log_info(message: str) -> None:
    """Log an info message."""
    print(f"ℹ️  {message}")


def log_error(message: str) -> None:
    """Log an error message."""
    print(f"❌ {message}", file=sys.stderr)


def log_warning(message: str) -> None:
    """Log a warning message."""
    print(f"⚠️  {message}")


def get_github_context() -> Dict[str, Any]:
    """Get GitHub Actions context from environment."""
    event_path = os.getenv("GITHUB_EVENT_PATH")
    if not event_path:
        return {}
    
    try:
        with open(event_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        log_warning(f"Could not load GitHub event: {e}")
        return {}


def get_current_pr_number(event_payload: Dict[str, Any]) -> Optional[int]:
    """Get the current PR number from the event payload."""
    pull_request = event_payload.get("pull_request", {})
    return pull_request.get("number")


def get_base_branch(event_payload: Dict[str, Any]) -> Optional[str]:
    """Get the base branch from the event payload."""
    pull_request = event_payload.get("pull_request", {})
    return pull_request.get("base", {}).get("ref")


def determine_pr_checking_strategy(event_name: str, event_payload: Dict[str, Any]) -> PRCheckingStrategy:
    """
    Determine PR filtering strategy based on trigger event.
    
    Returns:
        PRCheckingStrategy: Enum value indicating which strategy to use
    """
    if event_name in PULL_REQUEST_EVENTS:
        action = event_payload.get("action")

        if action == "synchronize":
            log_info(f"PR {action} - checking only current PR")
            return PRCheckingStrategy.CHECK_CURRENT_PR_ONLY
        elif action == "closed" and event_payload.get("pull_request", {}).get("merged"):
            base_branch = get_base_branch(event_payload)
            log_info(f"PR merged - checking all PRs targeting base branch: {base_branch}")
            return PRCheckingStrategy.CHECK_BASE_BRANCH_PRS
    
    log_info("Non-PR trigger - checking all open PRs regardless of base branch")
    return PRCheckingStrategy.CHECK_ALL_PRS


def filter_prs_by_base_branch(prs: List[Dict[str, Any]], base_branch: str) -> List[Dict[str, Any]]:
    """Filter PRs by base branch."""
    return [pr for pr in prs if pr.get("base", {}).get("ref") == base_branch]


def wait_for_mergeable_state(api: GitHubAPI, pr_number: int, max_retries: int, retry_delay: int) -> Dict[str, Any]:
    """Wait for GitHub to calculate mergeable state with retries."""
    pr_details = api.get_pr_details(pr_number)
    
    retries = 0
    while pr_details.get("mergeable_state") == MERGEABLE_STATES["UNKNOWN"] and retries < max_retries:
        log_info(f"  Waiting for mergeable state... (attempt {retries + 1})")
        time.sleep(retry_delay)
        pr_details = api.get_pr_details(pr_number)
        retries += 1
    
    return pr_details


def get_pr_diff(owner: str, repo: str, pr_number: int) -> Optional[str]:
    """
    Get PR diff using gh CLI.
    
    Returns the diff output, or None if the command fails.
    Requires gh CLI to be available and GITHUB_TOKEN to be set.
    """
    try:
        result = subprocess.run(
            ["gh", "pr", "diff", str(pr_number), "--repo", f"{owner}/{repo}"],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return result.stdout
        else:
            log_warning(f"  Could not get PR diff: {result.stderr.strip()}")
            return None
    except FileNotFoundError:
        log_warning("  gh CLI not found - cannot check for conflict markers")
        return None
    except subprocess.TimeoutExpired:
        log_warning("  Timeout getting PR diff")
        return None
    except Exception as e:
        log_warning(f"  Error getting PR diff: {e}")
        return None


def has_conflict_markers(diff_content: str) -> bool:
    """
    Check if diff contains unresolved conflict markers.
    
    Detects markers used by git:
    - <<<<<<< (start of conflict)
    - ======= (separator between versions)
    - >>>>>>> (end of conflict)
    
    This catches Mergify backport PRs where conflicts are committed as text.
    """
    if not diff_content:
        return False
    
    # Pattern to detect git conflict markers in diff
    # We look for lines starting with + (added in the diff) containing conflict markers
    lines = diff_content.split('\n')
    for line in lines:
        # Check for conflict markers (they appear in diff as +<<<<<<<, etc.)
        if re.search(r'^\+.*?<<<<<<<|^\+.*?=======|^\+.*?>>>>>>>', line):
            return True
    
    return False


def has_conflicts(mergeable: Optional[bool], mergeable_state: str, has_markers: bool = False) -> bool:
    """
    Check if PR has conflicts based on mergeable state and conflict markers.
    
    According to GitHub API:
    - mergeable: false + mergeable_state: "dirty" = has merge conflicts
    - mergeable_state: "behind" = behind base branch but mergeable (no conflicts)
    - mergeable_state: "blocked" = blocked by branch protection (not a conflict)
    - mergeable_state: "unstable" = failing checks (not a conflict)
    
    Additionally, checks for committed conflict markers (<<<<<<<, =======, >>>>>>>) which
    can appear in Mergify backport PRs where cherry-pick conflicts are committed as text.
    
    Returns True if:
    1. GitHub detects merge conflicts (dirty state), OR
    2. Conflict markers are found in the diff (Mergify backport case)
    """
    github_has_conflicts = mergeable is False and mergeable_state == MERGEABLE_STATES["DIRTY"]
    return github_has_conflicts or has_markers


def process_pr(api: GitHubAPI, pr: Dict[str, Any], conflict_label: str, max_retries: int, retry_delay: int) -> None:
    """Process a single PR for conflict checking and label management."""
    pr_number = pr["number"]
    pr_title = pr["title"]
    
    log_info(f"\nChecking PR #{pr_number}: {pr_title}")
    
    pr_details = wait_for_mergeable_state(api, pr_number, max_retries, retry_delay)
    
    mergeable = pr_details.get("mergeable")
    mergeable_state = pr_details.get("mergeable_state", "")
    current_labels = [label["name"] for label in pr_details.get("labels", [])]
    has_conflict_label = conflict_label in current_labels
    
    # Check for conflict markers in the diff (for Mergify backport PRs)
    diff_content = get_pr_diff(api.owner, api.repo, pr_number)
    has_markers = has_conflict_markers(diff_content) if diff_content else False
    
    pr_has_conflicts = has_conflicts(mergeable, mergeable_state, has_markers)
    
    log_info(f"  Mergeable: {mergeable}, State: {mergeable_state}")
    log_info(f"  Conflict markers in diff: {has_markers}")
    log_info(f"  Has conflicts: {pr_has_conflicts}, Has label: {has_conflict_label}")
    
    if pr_has_conflicts and not has_conflict_label:
        try:
            api.add_label(pr_number, conflict_label)
            log_info(f"  ✅ Added {conflict_label} label to PR #{pr_number}")
        except requests.exceptions.HTTPError as e:
            log_warning(f"  Could not add label: {e}")
    elif not pr_has_conflicts and has_conflict_label:
        try:
            api.remove_label(pr_number, conflict_label)
            log_info(f"  ✅ Removed {conflict_label} label from PR #{pr_number}")
        except requests.exceptions.HTTPError as e:
            log_warning(f"  Could not remove label: {e}")
    else:
        log_info(f"  ℹ️  No label changes needed for PR #{pr_number}")


def main():
    """Main function to run the conflict checking script."""
    # Get inputs from environment
    github_token = os.getenv("GITHUB_TOKEN")
    conflict_label = os.getenv("CONFLICT_LABEL", DEFAULT_CONFLICT_LABEL)
    max_retries = int(os.getenv("MAX_RETRIES", str(DEFAULT_MAX_RETRIES)))
    retry_delay = int(os.getenv("RETRY_DELAY", str(DEFAULT_RETRY_DELAY)))
    
    # Get GitHub context
    github_repository = os.getenv("GITHUB_REPOSITORY")
    event_name = os.getenv("GITHUB_EVENT_NAME", "")
    
    if not github_token:
        log_error("GITHUB_TOKEN environment variable is required")
        sys.exit(1)
    
    if not github_repository:
        log_error("GITHUB_REPOSITORY environment variable is required")
        sys.exit(1)
    
    try:
        owner, repo = github_repository.split("/")
    except ValueError:
        log_error(f"Invalid GITHUB_REPOSITORY format: {github_repository}")
        sys.exit(1)
    
    log_info(f"Checking repository: {owner}/{repo}")
    log_info(f"Event: {event_name}")
    
    # Initialize GitHub API client
    api = GitHubAPI(github_token, owner, repo)
    
    # Get event payload and determine strategy
    event_payload = get_github_context()
    log_info(f"Action: {event_payload.get('action', 'N/A')}")
    
    strategy = determine_pr_checking_strategy(event_name, event_payload)
    
    # Get PRs to check based on strategy
    if strategy == PRCheckingStrategy.CHECK_CURRENT_PR_ONLY:
        current_pr_number = get_current_pr_number(event_payload)
        if current_pr_number:
            log_info(f"Checking only current PR #{current_pr_number}")
            prs_to_check = [api.get_pr_details(current_pr_number)]
        else:
            log_error("Cannot get current PR number from event payload")
            sys.exit(1)
    
    elif strategy == PRCheckingStrategy.CHECK_BASE_BRANCH_PRS:
        base_branch = get_base_branch(event_payload)
        if base_branch:
            all_prs = api.fetch_open_prs()
            prs_to_check = filter_prs_by_base_branch(all_prs, base_branch)
            log_info(f"Filtered to {len(prs_to_check)} PRs targeting base branch '{base_branch}' "
                    f"(out of {len(all_prs)} total open PRs)")
        else:
            log_error("Cannot get base branch from event payload")
            sys.exit(1)
    
    else:  # CHECK_ALL_PRS
        all_prs = api.fetch_open_prs()
        prs_to_check = all_prs
        log_info(f"Found {len(all_prs)} open pull requests (checking all branches)")
    
    # Process each PR
    for pr in prs_to_check:
        try:
            process_pr(api, pr, conflict_label, max_retries, retry_delay)
        except Exception as e:
            log_error(f"  Error processing PR #{pr['number']}: {e}")
    
    log_info("\n✅ Conflict checking completed successfully")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log_error(f"Script failed: {e}")
        sys.exit(1)
