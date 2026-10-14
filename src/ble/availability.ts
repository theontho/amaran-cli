export interface ConnectionStatus {
  state: 'connected' | 'connecting' | 'offline' | 'recovering';
  nextRetryAt: number;
  lastError?: string;
  resetRequired: boolean;
}

export class BleUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 0,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'BleUnavailableError';
  }
}
