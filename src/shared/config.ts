const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Default configuration for the work-stealing component
 */
export const config = {
  // Timing
  /** Mark job as timed out after this duration (default: 60s) */
  WORKER_DEAD_TIMEOUT: 60 * SECOND,
  /** Workers should heartbeat at this interval (default: 20s) */
  WORKER_HEARTBEAT_INTERVAL: 20 * SECOND,
  /** Consider worker stale after this duration (default: 5min) */
  WORKER_STALE_THRESHOLD: 5 * MINUTE,
  
  // Retries
  /** Maximum retry attempts for failed jobs (default: 3) */
  MAX_JOB_RETRIES: 3,
  /** Base delay for exponential backoff (default: 5s) */
  RETRY_BACKOFF_BASE: 5 * SECOND,
  /** Maximum backoff delay (default: 5min) */
  MAX_RETRY_BACKOFF: 5 * MINUTE,
  
  // Cleanup
  /** Keep completed jobs for this duration (default: 24h) */
  COMPLETED_JOB_TTL: 24 * HOUR,
  /** Keep job history for this duration (default: 7 days) */
  JOB_HISTORY_TTL: 7 * 24 * HOUR,
  /** Keep dead letter jobs for this duration (default: 30 days) */
  DEAD_LETTER_TTL: 30 * 24 * HOUR,
  
  // Limits
  /** Default max concurrent jobs per worker */
  DEFAULT_MAX_CONCURRENT_JOBS: 1,
  /** Maximum payload size in bytes (default: 1MB) */
  MAX_PAYLOAD_SIZE: 1024 * 1024,
  /** Maximum result size in bytes (default: 1MB) */
  MAX_RESULT_SIZE: 1024 * 1024,
  /** Default priority for jobs */
  DEFAULT_PRIORITY: 0,
  
  // Batch
  /** Maximum jobs per batch submission */
  MAX_BATCH_SIZE: 100,
  /** Jobs to fetch when looking for work */
  WORK_FETCH_LIMIT: 20,
} as const;

export type Config = typeof config;

/**
 * Create a custom config by merging with defaults
 */
export function createConfig(overrides: Partial<Config>): Config {
  return { ...config, ...overrides };
}
