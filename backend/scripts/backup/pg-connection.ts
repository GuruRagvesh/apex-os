/**
 * Running pg_dump / pg_restore without putting a password on the command line.
 *
 * A connection string passed as an argv is not private. It appears in the
 * process table, and — the way this actually bit us — Node puts the whole
 * command into the message of any exec error, so a single failed restore
 * printed the live password into the terminal, and would have printed it into
 * Render and CI logs too.
 *
 * So the password travels out of band in PGPASSWORD, which libpq reads from the
 * environment, and the visible command carries a connection string with the
 * password removed. Host, port, database and user still appear, because those
 * are what make an error diagnosable.
 *
 * Belt and braces: runPgTool also scrubs any secret out of whatever the tool
 * wrote to stderr before that text reaches an error message.
 */

import { execFile } from 'child_process';

export interface PgTarget {
  /** Safe to appear in a command line, an error, or a log. */
  safeConnectionString: string;
  /** Passed through the child's environment, never as an argument. */
  password: string | null;
  host: string;
  port: string;
  database: string;
  user: string;
}

/** Splits a connection string into a printable target and a private password. */
export function toPgTarget(connectionString: string): PgTarget {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Connection string could not be parsed.');
  }

  const password = url.password ? decodeURIComponent(url.password) : null;
  const user = url.username ? decodeURIComponent(url.username) : '';

  // Rebuild without the password rather than string-replacing it: a password
  // containing regex or URL metacharacters would survive a naive replace.
  const safe = new URL(connectionString);
  safe.password = '';

  return {
    safeConnectionString: safe.toString(),
    password,
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
    user,
  };
}

/** A connection string with its password replaced, for diagnostics. */
export function redactConnectionString(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    // Not a URL. Redact anything that looks like credentials in a URL anyway,
    // since this is only ever called on text that might contain one.
    return value.replace(/(\w+:\/\/[^:@\s]+):[^@\s]+@/g, '$1:***@');
  }
}

/**
 * Removes known secret values from arbitrary text.
 *
 * Used on tool output before it becomes an error message. Empty and very short
 * values are skipped: replacing those would mangle unrelated text without
 * protecting anything.
 */
export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    out = out.split(secret).join('***');
  }
  return redactConnectionString(out);
}

export interface PgToolResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a Postgres client tool with the password supplied through the
 * environment.
 *
 * Any failure is re-thrown with a message built from the tool name, the
 * redacted target and scrubbed stderr — never from the raw exec error, whose
 * message embeds the full command.
 */
export function runPgTool(
  tool: string,
  args: string[],
  target: PgTarget,
  options: { maxBuffer?: number } = {},
): Promise<PgToolResult> {
  return new Promise((resolve, reject) => {
    execFile(
      tool,
      args,
      {
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        env: {
          ...process.env,
          ...(target.password ? { PGPASSWORD: target.password } : {}),
        },
      },
      (error, stdout, stderr) => {
        const safeStderr = redactSecrets(String(stderr ?? ''), [target.password]);
        if (error) {
          reject(
            new Error(
              `${tool} failed against ${target.host}:${target.port}/${target.database} ` +
                `as ${target.user || '(default user)'}` +
                (safeStderr.trim() ? `: ${safeStderr.trim()}` : ''),
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: safeStderr });
      },
    );
  });
}
