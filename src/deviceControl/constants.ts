// Device control defaults
export const DEVICE_DEFAULTS = {
  updateInterval: 500, // milliseconds for smooth visual simulation
  simulationDuration: 10, // seconds to compress full day
  reconnectAttempts: 3,
  reconnectDelay: 1000, // milliseconds
  commandThrottleDelay: 250, // milliseconds between commands to avoid overwhelming server
  statusCheckDelay: 250, // milliseconds for device status checks
};

// Validation ranges
export const VALIDATION_RANGES = {
  cct: { min: 1000, max: 20000 },
  intensity: { min: 0, max: 100 },
};

// Error messages
export const ERROR_MESSAGES = {
  invalidDuration: 'Duration must be at least 1 second',
  deviceNotFound: (device: string) => `Device "${device}" not found`,
} as const;
