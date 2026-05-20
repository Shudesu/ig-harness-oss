import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup } from "./commands/setup.js";
import { runUpdate } from "./commands/update.js";
import { WranglerError } from "./lib/wrangler.js";
import { ensureRepo } from "./steps/clone-repo.js";

const args = process.argv.slice(2);

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`IG Harness setup CLI

Usage:
  create-ig-harness [setup|update] [--repo-dir <path>]
  create-ig-harness --help
  create-ig-harness --version

Commands:
  setup   Set up IG Harness locally and on Cloudflare (default)
  update  Update an existing IG Harness installation

Options:
  --repo-dir <path>  Use an existing repository directory
  -h, --help         Show this help
  -v, --version      Show the package version`);
}

function parseArgs(): {
  command: string;
  repoDir: string | null;
  help: boolean;
  version: boolean;
} {
  let command = "setup";
  let repoDir: string | null = null;
  let help = false;
  let version = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "--help") {
      help = true;
    } else if (args[i] === "-v" || args[i] === "--version") {
      version = true;
    } else if (args[i] === "--repo-dir" && args[i + 1]) {
      repoDir = resolve(args[i + 1]);
      i++;
    } else if (!args[i].startsWith("-")) {
      command = args[i];
    }
  }

  return { command, repoDir, help, version };
}

function getConfigDir(explicitRepoDir: string | null): string {
  if (explicitRepoDir) return explicitRepoDir;
  const cwdState = join(process.cwd(), ".ig-harness-deployed.json");
  if (existsSync(cwdState)) return process.cwd();
  const home = homedir() || process.env.HOME || process.env.USERPROFILE || tmpdir();
  const dir = join(home, ".ig-harness");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function main(): Promise<void> {
  const { command, repoDir: explicitRepoDir, help, version } = parseArgs();

  if (help) {
    printHelp();
    return;
  }

  if (version) {
    console.log(readPackageVersion());
    return;
  }

  if (command === "setup") {
    // Setup needs the actual template repo so it can deploy Worker/Admin code.
    const repoDir = await ensureRepo(explicitRepoDir);
    await runSetup(repoDir);
  } else if (command === "update") {
    // Update reads persisted deployed state and talks to Cloudflare directly.
    // Avoid a surprising clone/pull when operators only want to redeploy.
    const repoDir = getConfigDir(explicitRepoDir);
    await runUpdate(repoDir);
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Run `create-ig-harness --help` for usage.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  if (error instanceof WranglerError) {
    const help = error.getHelp();
    if (help) console.error(`\nHint:\n${help}`);
  }
  process.exit(1);
});
