export async function deadline<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineError(label)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export class DeadlineError extends Error {
  constructor(readonly label: string) {
    super(`${label} timed out`);
    this.name = 'DeadlineError';
  }
}
