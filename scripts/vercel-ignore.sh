#!/bin/bash

# Exit code 0 = Skip/Ignore the build
# Exit code 1 = Proceed with the build

echo "🔍 - Checking if build should be ignored..."
echo "Commit message: $VERCEL_GIT_COMMIT_MESSAGE"
echo "Commit author: $VERCEL_GIT_COMMIT_AUTHOR_LOGIN"
echo "Commit ref: $VERCEL_GIT_COMMIT_REF"

# Only build the production branch (main); skip every other branch
if [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then
  echo "🛑 - Skipping build: not the main branch ($VERCEL_GIT_COMMIT_REF)"
  exit 0
fi

# Skip if commit is authored by Dependabot
if [ "$VERCEL_GIT_COMMIT_AUTHOR_LOGIN" = "dependabot[bot]" ]; then
  echo "🛑 - Skipping build: Author is Dependabot"
  exit 0
fi

# Skip if the commit ref is a dependabot branch
if [[ "$VERCEL_GIT_COMMIT_REF" == dependabot/* ]]; then
  echo "🛑 - Skipping build: Branch is Dependabot"
  exit 0
fi

# Skip if the commit message starts with chore(deps)
if [[ "$VERCEL_GIT_COMMIT_MESSAGE" == chore\(deps\)* ]]; then
  echo "🛑 - Skipping build: Commit message matches chore(deps)"
  exit 0
fi

# Otherwise, proceed with the build
echo "✅ - Proceeding with build"
exit 1
