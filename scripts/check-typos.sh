#!/bin/bash

# Script to check for typos in changed files
# Usage: ./check-typos.sh <files-list>

# Initialize variables to prevent context access warnings
echo "status=clean" >> $GITHUB_OUTPUT
echo "message=No typos found." >> $GITHUB_OUTPUT

FILES="${1:?Files list not provided}"

if [ -z "$FILES" ]; then
  echo "status=clean" >> $GITHUB_OUTPUT
  echo "message=No changed files in PR." >> $GITHUB_OUTPUT
  exit 0
fi

# Remove trailing backslashes from YAML line continuations and normalize whitespace
FILES=$(echo "$FILES" | sed 's/\\$//g' | tr '\n' ' ' | xargs)

# Use config from repo, fall back to default from reusable repo
if [ -f ".typos.toml" ]; then
  CONFIG="--config .typos.toml"
elif [ -f ".github-repo/.github/.typos.toml" ]; then
  CONFIG="--config .github-repo/.github/.typos.toml"
else
  CONFIG=""
fi

# Filter out excluded files from the file list
# Extract exclude patterns from .typos.toml and filter files
FILTERED_FILES=""
for file in $FILES; do
  # Skip files matching smoketest/** and mibs/**
  if [[ ! "$file" =~ ^smoketest/ ]] && [[ ! "$file" =~ ^mibs/ ]]; then
    FILTERED_FILES="$FILTERED_FILES $file"
  fi
done

# Use filtered list for typos
FILES_TO_CHECK=$FILTERED_FILES

if [ -z "$FILES_TO_CHECK" ]; then
  echo "status=clean" >> $GITHUB_OUTPUT
  echo "message=No files to check after applying exclusions." >> $GITHUB_OUTPUT
  exit 0
fi

# Run typos with JSON output
typos $CONFIG --format json $FILES_TO_CHECK > typos-output.json 2>&1 || EXIT_CODE=$?
EXIT_CODE=${EXIT_CODE:-0}

if [ "$EXIT_CODE" = "0" ]; then
  echo "status=clean" >> $GITHUB_OUTPUT
  echo "message=No typos found in changed files." >> $GITHUB_OUTPUT
  echo "✅ No typos found in changed files."
elif [ "$EXIT_CODE" = "2" ]; then
  echo "status=issues" >> $GITHUB_OUTPUT
  echo "message=Typos detected in PR." >> $GITHUB_OUTPUT
  echo "❌ Typos detected:"
  cat typos-output.json
else
  echo "status=error" >> $GITHUB_OUTPUT
  echo "message=Error running typos check." >> $GITHUB_OUTPUT
  echo "ERROR: Typos check failed with exit code $EXIT_CODE" >&2
  cat typos-output.json >&2
  exit 1
fi


