/**
 * Structured logs: one JSON object per line on stdout, so any log collector can parse them.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
let minRank = RANK.info;

/** Credentials and emails never reach the logs, even if a caller passes one by mistake. */
const SECRET_KEY = /token|password|secret|authorization|cookie|email/i;

export function setLogLevel(level: LogLevel): void {
  minRank = RANK[level];
}

function write(level: Exclude<LogLevel, 'silent'>, msg: string, fields?: Record<string, unknown>): void {
  if (RANK[level] < minRank) return;
  const line: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (key in line) continue;
      line[key] = SECRET_KEY.test(key) ? '[redacted]' : value instanceof Error ? { message: value.message, stack: value.stack } : value;
    }
  }
  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({ time: line.time, level, msg, logError: 'fields could not be serialized' });
  }
  process.stdout.write(text + '\n');
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};

/** Resolves once everything logged so far has been handed to the OS (stdout is async on pipes). */
export function flushLogs(): Promise<void> {
  return new Promise(resolve => process.stdout.write('', () => resolve()));
}
