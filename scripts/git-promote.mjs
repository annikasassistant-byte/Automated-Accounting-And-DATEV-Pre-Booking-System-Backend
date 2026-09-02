#!/usr/bin/env node
/**
 * Promote code between git branches.
 *
 *   npm run promote:staging      dev → before_production
 *   npm run promote:production   before_production → production
 *
 * Flags: --dry-run  --no-checkout
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const mode = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const noCheckout = process.argv.includes("--no-checkout");

const MODES = {
  staging: {
    label: "dev → before_production",
    branch: "before_production",
    source: "dev",
    message: "take code from dev branch",
  },
  production: {
    label: "before_production → production",
    branch: "production",
    source: "before_production",
    message: "take code from before_production",
  },
};

function gitRun(cmd) {
  const full = `git ${cmd}`;
  console.log(`> ${full}`);
  if (dryRun) return;
  execSync(full, { cwd: repoRoot, stdio: "inherit" });
}

function gitOut(cmd) {
  if (dryRun) return "";
  return execSync(`git ${cmd}`, {
    encoding: "utf8",
    cwd: repoRoot,
    stdio: "pipe",
  }).trim();
}

function assertGitRepo() {
  if (!existsSync(path.join(repoRoot, ".git"))) {
    console.error(`Not a git repo: ${repoRoot}`);
    process.exit(1);
  }
}

function hasLocalChanges() {
  return gitOut("status --porcelain").length > 0;
}

function tryCommit(message) {
  if (dryRun) {
    gitRun(`commit -m "${message}"`);
    return;
  }
  try {
    execSync(`git commit -m "${message}"`, {
      cwd: repoRoot,
      stdio: "inherit",
    });
  } catch {
    console.log("(No commit needed — branch already matches source after pull.)");
  }
}

const repoRoot = process.cwd();
const config = MODES[mode];

if (!config) {
  console.error("Usage: npm run promote:staging | promote:production [-- --dry-run]");
  process.exit(1);
}

assertGitRepo();

const repoName = path.basename(repoRoot);
const current = dryRun ? "(dry-run)" : gitOut("rev-parse --abbrev-ref HEAD");

console.log("");
console.log(`=== ${repoName}: promote ${config.label} ===`);
console.log(`Current branch: ${current}`);
if (dryRun) console.log("(dry-run — no git changes will be made)");
console.log("");

if (!dryRun && hasLocalChanges()) {
  console.error("Abort: uncommitted changes in this repo. Commit or stash first.");
  process.exit(1);
}

if (!dryRun && current !== config.branch) {
  if (noCheckout) {
    console.error(`Abort: expected branch "${config.branch}" but on "${current}".`);
    process.exit(1);
  }
  gitRun(`checkout ${config.branch}`);
}

gitRun(`pull origin ${config.source}`);
gitRun("add .");
tryCommit(config.message);
gitRun(`push origin ${config.branch}`);

console.log("");
console.log("Done. See PRODUCTION.md for verify steps.");
