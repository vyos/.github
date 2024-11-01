#!/usr/bin/env python3

import re
import sys
import time

import requests

# Use the same regex for PR title and commit messages for now
title_regex = r'^(([a-zA-Z0-9\-_.]+:\s)?)T\d+:\s+[^\s]+.*'
commit_regex = title_regex

def check_pr_title(title):
    if not re.match(title_regex, title):
        print("PR title '{}' does not match the required format!".format(title))
        print("Valid title example: T99999: make IPsec secure")
        sys.exit(1)

def check_commit_message(title):
    if not re.match(commit_regex, title):
        print("Commit title '{}' does not match the required format!".format(title))
        print("Valid title example: T99999: make IPsec secure")
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: {} <pull_request_url> <github_token>".format(sys.argv[0]))
        sys.exit(1)

    pr_url = sys.argv[1]
    github_token = sys.argv[2]

    headers = {
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github.v3+json'
    }

    # There seems to be a race condition that causes this scripts to receive
    # an incomplete PR object that is missing certain fields,
    # which causes temporary CI failures that require re-running the script
    #
    # It's probably better to add a small delay to prevent that
    time.sleep(5)

    # Get the pull request object
    pr_response = requests.get(pr_url, headers=headers)
    pr_response.raise_for_status()
    pr = pr_response.json()
    if "title" not in pr:
        print("The PR object does not have a title field!")
        print("Did not receive a valid pull request object, please check the URL!")
        sys.exit(1)

    check_pr_title(pr["title"])

    # Get the list of commits
    commits = requests.get(pr["commits_url"]).json()
    for c in commits:
        # Retrieve every individual commit and check its title
        co = requests.get(c["url"]).json()
        check_commit_message(co["commit"]["message"])