#!/usr/bin/env bash
set -euo pipefail

# Create a new git worktree with a new branch based on the current branch
# Usage: ./scripts/create-worktree.sh <new-branch-name>

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <new-branch-name>"
    echo "Creates a new worktree with a new branch based on the current branch"
    exit 1
fi

NEW_BRANCH="$1"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREES_DIR="${REPO_ROOT}/../worktrees"
WORKTREE_PATH="${WORKTREES_DIR}/${NEW_BRANCH}"

# Create worktrees directory if it doesn't exist
mkdir -p "$WORKTREES_DIR"

echo "Creating worktree with new branch: ${NEW_BRANCH}"
echo "Based on: ${CURRENT_BRANCH}"
echo "Worktree path: ${WORKTREE_PATH}"

git worktree add -b "$NEW_BRANCH" "$WORKTREE_PATH" "$CURRENT_BRANCH"

echo ""
echo "Worktree created successfully!"
echo "To switch to it: cd ${WORKTREE_PATH}"