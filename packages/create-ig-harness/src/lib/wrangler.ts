import { execa } from "execa";

export class WranglerError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "WranglerError";
  }

  getHelp(): string | null {
    const text = `${this.message}\n${this.stderr}`.toLowerCase();
    const hints: string[] = [];

    if (text.includes("code: 10034") || text.includes("code:10034")) {
      hints.push(
        "Cloudflare アカウントのメール認証が完了していません。Cloudflare ダッシュボードに届く確認メールを開いて認証してください。",
      );
    }
    if (
      text.includes("authentication error") ||
      text.includes("code: 10000") ||
      text.includes("code:10000")
    ) {
      hints.push(
        "認証 / アカウント不一致の可能性があります。`npx wrangler whoami` でログイン中の Cloudflare アカウントを確認してください。",
      );
    }
    if (text.includes("not authenticated") || text.includes("you are not authenticated")) {
      hints.push("OAuth トークンが切れています。`npx wrangler logout && npx wrangler login` で再ログインしてください。");
    }
    if (text.includes("non-interactive") || text.includes("cloudflare_api_token")) {
      hints.push(
        "wrangler が TTY 不在で認証更新できない状態です。CLI が対話モードで再試行できない箇所なら Issue で報告してください。",
      );
    }
    if (text.includes("d1_create_too_many_databases") || text.includes("too many databases")) {
      hints.push("D1 の無料枠を使い切っています。古い D1 を削除するか有料プランへ移行してください。");
    }

    return hints.length > 0 ? hints.join("\n") : null;
  }
}

let accountId: string | undefined;

export function setAccountId(id: string): void {
  accountId = id;
}

export interface WranglerOptions {
  input?: string;
  cwd?: string;
  tty?: boolean;
}

export async function wrangler(
  args: string[],
  options?: WranglerOptions,
): Promise<string> {
  const env: Record<string, string> = { ...process.env, FORCE_COLOR: "0" } as Record<string, string>;
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;

  if (options?.tty) {
    if (options.input !== undefined) {
      throw new Error("wrangler({ tty: true }) does not support input.");
    }
    try {
      await execa("npx", ["wrangler", ...args], {
        cwd: options.cwd,
        env,
        stdio: "inherit",
      });
      return "";
    } catch (error: any) {
      const message = error?.shortMessage || error?.message || "unknown error";
      throw new WranglerError(`wrangler ${args[0]} failed: ${message}`, "");
    }
  }

  const input = options?.input ?? "y\n".repeat(50);
  try {
    const result = await execa("npx", ["wrangler", ...args], {
      cwd: options?.cwd,
      input,
      env,
    });
    return result.stdout;
  } catch (error: any) {
    throw new WranglerError(
      `wrangler ${args[0]} failed: ${error.stderr || error.message}`,
      error.stderr || "",
    );
  }
}

/**
 * Run wrangler with full stdio inheritance (for interactive commands like login).
 * Cannot capture output — use only when user interaction is needed.
 */
export async function wranglerInteractive(args: string[]): Promise<void> {
  await execa("npx", ["wrangler", ...args], {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1", ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
  });
}

export async function isWranglerAuthenticated(): Promise<boolean> {
  try {
    const output = await wrangler(["whoami"]);
    return !output.toLowerCase().includes("not authenticated");
  } catch {
    return false;
  }
}
