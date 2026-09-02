#!/usr/bin/env node
/**
 * Install a git post-checkout hook — reminds you to open PRODUCTION.md
 * when you switch to the `production` branch.
 *
 *   npm run setup:production-hook
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const gitDir = path.join(repoRoot, ".git");
const hooksDir = path.join(gitDir, "hooks");
const hookPath = path.join(hooksDir, "post-checkout");
const marker = "# automated-accounting-production-checkout-v3";

const hookBody = `#!/bin/sh
${marker}
if [ "$3" = "1" ]; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$branch" = "production" ]; then
    echo ""
    echo "=========================================="
    echo "  production branch — live deploy"
    echo "  Open:     PRODUCTION.md  (git steps + package.json links)"
    echo "  Promote:  npm run promote:production"
    echo "=========================================="
    echo ""
  fi
fi
`;

if (!existsSync(gitDir)) {
  console.error(`Not a git repo: ${repoRoot}`);
  process.exit(1);
}

mkdirSync(hooksDir, { recursive: true });
writeFileSync(hookPath, hookBody, "utf8");
try {
  chmodSync(hookPath, 0o755);
} catch {
  // Windows may ignore chmod
}

console.log(`Installed post-checkout hook: ${hookPath}`);
console.log("When you `git checkout production`, you will see the promote reminder.");
