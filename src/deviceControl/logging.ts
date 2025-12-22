import chalk from 'chalk';

/**
 * Returns a formatted ISO timestamp in gray brackets: [2025-10-26T14:30:00.000Z]
 */
export function getTimestamp(): string {
  return chalk.gray(`[${new Date().toISOString()}] `);
}

let isGlobalTimestampsEnabled = false;

/**
 * Overrides global console.log and console.error to prepend timestamps.
 */
export function enableGlobalTimestamps(): void {
  if (isGlobalTimestampsEnabled) return;

  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    process.stdout.write(getTimestamp());
    originalLog.apply(console, args);
  };

  console.error = (...args: unknown[]) => {
    process.stderr.write(getTimestamp());
    originalError.apply(console, args);
  };

  isGlobalTimestampsEnabled = true;
}

/**
 * Logs a message with a timestamp (legacy, now handled by global console).
 */
export function logWithTimestamp(message: string, color?: (msg: string) => string): void {
  const formattedMsg = color ? color(message) : message;
  console.log(formattedMsg);
}

/**
 * Logs an error message with a timestamp (legacy, now handled by global console).
 */
export function errorWithTimestamp(message: string, color?: (msg: string) => string): void {
  const formattedMsg = color ? color(message) : message;
  console.error(formattedMsg);
}
