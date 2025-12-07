/**
 * Job status values
 */
export type JobStatus =
  | "pending"
  | "inProgress"
  | "success"
  | "failed"
  | "timedOut"
  | "cancelled";

/**
 * Job history event types
 */
export type JobEvent =
  | "created"
  | "claimed"
  | "heartbeat"
  | "completed"
  | "failed"
  | "timedOut"
  | "retried"
  | "cancelled"
  | "movedToDLQ";

/**
 * Work specification for a job
 */
export interface WorkSpec {
  type: string;
  payload: unknown;
  priority?: number;
  requiredCapabilities?: string[];
}

/**
 * Job submission arguments
 */
export interface SubmitJobArgs {
  type: string;
  payload: unknown;
  priority?: number;
  requiredCapabilities?: string[];
  maxRetries?: number;
  externalId?: string;
  tags?: string[];
  batchId?: string;
  dependsOn?: string[];
}

/**
 * Batch job submission arguments
 */
export interface SubmitBatchArgs {
  jobs: SubmitJobArgs[];
  batchId?: string;
}

/**
 * Worker registration arguments
 */
export interface RegisterWorkerArgs {
  name: string;
  orgId: string;
  allowedCapabilities: string[];
  maxConcurrentJobs?: number;
  createdBy: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
  allowedJobTypes?: string[];
  rateLimitPerMinute?: number;
}

/**
 * Worker registration result
 */
export interface RegisterWorkerResult {
  apiKey: string;
  apiKeyPrefix: string;
  workerId: string;
}

/**
 * Job status response
 */
export interface JobStatusResponse {
  id: string;
  status: JobStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  workerId?: string;
}

/**
 * Batch status response
 */
export interface BatchStatusResponse {
  batchId: string;
  total: number;
  pending: number;
  inProgress: number;
  success: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  jobs: JobStatusResponse[];
}

/**
 * Worker status
 */
export type WorkerStatus = "active" | "stale" | "revoked" | "expired";

/**
 * Worker info response
 */
export interface WorkerInfo {
  id: string;
  name: string;
  orgId: string;
  status: WorkerStatus;
  capabilities: string[];
  maxConcurrentJobs: number;
  currentJobCount: number;
  lastSeen?: number;
  createdAt: number;
  expiresAt?: number;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  byStatus: Record<JobStatus, number>;
  totalPending: number;
  totalInProgress: number;
  avgWaitTimeMs: number;
  oldestPendingAge?: number;
  activeWorkers: number;
  totalWorkers: number;
}

/**
 * Work item returned to CLI worker
 */
export interface WorkItem {
  jobId: string;
  type: string;
  payload: unknown;
  priority?: number;
}

/**
 * Result submission state
 */
export type ResultState = "streaming" | "success" | "failed";

/**
 * Job handler function type for CLI workers
 */
export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: JobContext
) => Promise<TResult>;

/**
 * Context passed to job handlers
 */
export interface JobContext {
  jobId: string;
  type: string;
  sendProgress: (data: unknown) => Promise<void>;
}

/**
 * CLI Worker configuration
 */
export interface WorkerConfig {
  convexUrl: string;
  apiKey: string;
  capabilities?: string[];
  heartbeatInterval?: number;
  handlers: Record<string, JobHandler>;
  onError?: (error: Error, jobId?: string) => void;
  onJobStart?: (jobId: string, type: string) => void;
  onJobComplete?: (jobId: string, type: string, duration: number) => void;
}
