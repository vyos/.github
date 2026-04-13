#!/usr/bin/env python3
"""
Generate Copilot-style PR comment from typos JSON output.

Reads typos-output.json (native typos --format json output),
parses it to extract issues, and generates formatted markdown
comment with clickable file:line links.
"""

import json
import os
import sys

def parse_typos_json(json_data):
    """Parse typos JSON output (jsonlines format)."""
    issues = []
    
    # Process each line of jsonlines output
    for line in json_data.strip().split('\n'):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
            # Extract issue information
            if 'typo' in entry and 'corrections' in entry:
                issue = {
                    "path": entry.get('path', ''),
                    "line": entry.get('line_num', 0),
                    "typo": entry['typo'],
                    "fix": entry['corrections'][0] if entry['corrections'] else entry['typo']
                }
                issues.append(issue)
        except json.JSONDecodeError:
            continue
    
    return issues

def format_comment(issues, commit_sha=None, repo_url=None):
    """Format typos issues as Copilot-style markdown comment."""
    if not issues:
        return "✅ No typos found in changed files."
    
    message = f"❌ Typos detected in PR ({len(issues)} found)\n\n"
    message += "| File | Typo | Suggestion |\n"
    message += "|------|------|-------------|\n"
    
    for issue in issues:
        # Create clickable link to file and line
        if commit_sha and repo_url:
            # Use full GitHub blob URL
            file_url = f"{repo_url}/blob/{commit_sha}/{issue['path']}#L{issue['line']}"
            file_link = f"[{issue['path']}:{issue['line']}]({file_url})"
        else:
            # Fallback to relative link
            file_link = f"[{issue['path']}:{issue['line']}]({issue['path']}#L{issue['line']})"
        
        message += f"| {file_link} | `{issue['typo']}` | `{issue['fix']}` |\n"
    
    return message

def main():
    """Main entry point."""
    # Get environment variables
    commit_sha = os.getenv('COMMIT_SHA')
    repo_url = os.getenv('REPO_URL')
    
    # Read JSON output
    if not os.path.exists('typos-output.json'):
        comment = "✅ No typos found in changed files."
    else:
        with open('typos-output.json', 'r') as f:
            json_data = f.read()
        
        if json_data.strip():
            # Parse issues
            issues = parse_typos_json(json_data)
            
            # Generate comment with proper links
            comment = format_comment(issues, commit_sha, repo_url)
        else:
            comment = "✅ No typos found in changed files."
    
    # Output to GitHub environment
    with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
        f.write(f"message<<EOF\n{comment}\nEOF\n")
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
