import type {
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { hashApiKey, generateApiKey, getApiKeyPrefix, type HashFunction } from "../shared/crypto.js";
import { config, type Config } from "../shared/config.js";
import type {
  SubmitJobArgs,
  SubmitBatchArgs,
  RegisterWorkerArgs,
  RegisterWorkerResult,
  JobStatusResponse,
  BatchStatusResponse,
  WorkerInfo,
  QueueStats,
} from "../shared/types.js";

type MutationCtx = GenericMutationCtx<GenericDataModel>;
type QueryCtx = GenericQueryCtx<GenericDataModel>;

export interface WorkStealingClientOptions {
  /**
   * Custom hash function for API keys.
   * If not provided, uses built-in SHA-256 hashing.
   * Use this to integrate with better-auth or custom hashing schemes.
   */
  hashApiKey?: HashFunction;
  
  /**
   * API key prefix (e.g., "sk_live_", "sk_test_")
   */
  apiKeyPrefix?: string;
  
  /**
   * Custom configuration overrides
   */
  config?: Partial<Config>;
}

/**
 * Client for interacting with the work-stealing component from your Convex app.
 * 
 * @example
 * ```ts
 * import { WorkStealingClient } from "@convex-dev/work-stealing/client";
 * import { components } from "./_generated/api";
 * 
 * const workStealing = new WorkStealingClient(components.workStealing);
 * 
 * // In a mutation:
 * const jobId = await workStealing.submitJob(ctx, {
 *   orgId: user.orgId,
 *   type: "process-file",
 *   payload: { fileId: "..." },
 * });
 * ```
 */
export class WorkStealingClient {
  private component: ComponentApi;
  private hashFn: HashFunction;
  private apiKeyPrefix: string;
  private config: Config;
  
  constructor(component: ComponentApi, options?: WorkStealingClientOptions) {
    this.component = component;
    this.hashFn = options?.hashApiKey ?? hashApiKey;
    this.apiKeyPrefix = options?.apiKeyPrefix ?? "sk_live_";
    this.config = { ...config, ...options?.config };
  }
  
  // ============================================
  // Job Submission
  // ============================================
  
  /**
   * Submit a single job to the queue
   */
  async submitJob(
    ctx: Pick<MutationCtx, "runMutation">,
    args: SubmitJobArgs & { orgId: string; submittedBy?: string }
  ): Promise<string> {
    return await ctx.runMutation(this.component.jobs.submitJob, {
      orgId: args.orgId,
      type: args.type,
      payload: args.payload,
      priority: args.priority,
      requiredCapabilities: args.requiredCapabilities,
      maxRetries: args.maxRetries,
      externalId: args.externalId,
      tags: args.tags,
      batchId: args.batchId,
      dependsOn: args.dependsOn,
      submittedBy: args.submittedBy,
    });
  }
  
  /**
   * Submit multiple jobs atomically
   */
  async submitJobs(
    ctx: Pick<MutationCtx, "runMutation">,
    args: SubmitBatchArgs & { orgId: string }
  ): Promise<string[]> {
    return await ctx.runMutation(this.component.jobs.submitJobs, {
      orgId: args.orgId,
      jobs: args.jobs,
      batchId: args.batchId,
    });
  }
  
  /**
   * Cancel a job
   */
  async cancelJob(
    ctx: Pick<MutationCtx, "runMutation">,
    jobId: string
  ): Promise<{ cancelled: boolean; previousStatus: string }> {
    return await ctx.runMutation(this.component.jobs.cancelJob, { jobId });
  }
  
  // ============================================
  // Job Queries
  // ============================================
  
  /**
   * Get job status by ID
   */
  async getJobStatus(
    ctx: Pick<QueryCtx, "runQuery">,
    jobId: string
  ): Promise<JobStatusResponse | null> {
    return await ctx.runQuery(this.component.jobs.getJobStatus, { jobId });
  }
  
  /**
   * Get job by external ID
   */
  async getJobByExternalId(
    ctx: Pick<QueryCtx, "runQuery">,
    externalId: string
  ): Promise<JobStatusResponse | null> {
    return await ctx.runQuery(this.component.jobs.getJobByExternalId, { externalId });
  }
  
  /**
   * Get batch status
   */
  async getBatchStatus(
    ctx: Pick<QueryCtx, "runQuery">,
    batchId: string
  ): Promise<BatchStatusResponse> {
    return await ctx.runQuery(this.component.jobs.getBatchStatus, { batchId });
  }
  
  /**
   * Get queue statistics
   */
  async getQueueStats(
    ctx: Pick<QueryCtx, "runQuery">,
    orgId: string
  ): Promise<QueueStats> {
    return await ctx.runQuery(this.component.jobs.getQueueStats, { orgId }) as QueueStats;
  }
  
  /**
   * Get dead letter jobs
   */
  async getDeadLetterJobs(
    ctx: Pick<QueryCtx, "runQuery">,
    orgId: string,
    limit?: number
  ): Promise<Array<{ id: string; originalJobId: string; type: string; error?: string; retryCount: number; movedAt: number }>> {
    return await ctx.runQuery(this.component.jobs.getDeadLetterJobs, { orgId, limit });
  }
  
  /**
   * Retry a job from dead letter queue
   */
  async retryDeadLetter(
    ctx: Pick<MutationCtx, "runMutation">,
    deadLetterId: string
  ): Promise<string> {
    return await ctx.runMutation(this.component.jobs.retryDeadLetter, { deadLetterId });
  }
  
  // ============================================
  // Worker Management
  // ============================================
  
  /**
   * Register a new worker and generate an API key
   */
  async registerWorker(
    ctx: Pick<MutationCtx, "runMutation">,
    args: RegisterWorkerArgs
  ): Promise<RegisterWorkerResult> {
    // Generate a new API key
    const apiKey = generateApiKey(this.apiKeyPrefix);
    const apiKeyHash = await this.hashFn(apiKey);
    const apiKeyPrefixStr = getApiKeyPrefix(apiKey);
    
    const workerId = await ctx.runMutation(this.component.workers.registerWorkerWithHash, {
      apiKeyHash,
      apiKeyPrefix: apiKeyPrefixStr,
      name: args.name,
      orgId: args.orgId,
      allowedCapabilities: args.allowedCapabilities,
      maxConcurrentJobs: args.maxConcurrentJobs ?? this.config.DEFAULT_MAX_CONCURRENT_JOBS,
      createdBy: args.createdBy,
      expiresAt: args.expiresAt,
      metadata: args.metadata,
      allowedJobTypes: args.allowedJobTypes,
      rateLimitPerMinute: args.rateLimitPerMinute,
    });
    
    return {
      apiKey,
      apiKeyPrefix: apiKeyPrefixStr,
      workerId: workerId as string,
    };
  }
  
  /**
   * Register a worker with a pre-hashed API key
   * Use this when integrating with better-auth or managing keys externally
   */
  async registerWorkerWithHash(
    ctx: Pick<MutationCtx, "runMutation">,
    args: Omit<RegisterWorkerArgs, "createdBy"> & {
      apiKeyHash: string;
      apiKeyPrefix: string;
      createdBy: string;
    }
  ): Promise<string> {
    return await ctx.runMutation(this.component.workers.registerWorkerWithHash, {
      apiKeyHash: args.apiKeyHash,
      apiKeyPrefix: args.apiKeyPrefix,
      name: args.name,
      orgId: args.orgId,
      allowedCapabilities: args.allowedCapabilities,
      maxConcurrentJobs: args.maxConcurrentJobs ?? this.config.DEFAULT_MAX_CONCURRENT_JOBS,
      createdBy: args.createdBy,
      expiresAt: args.expiresAt,
      metadata: args.metadata,
      allowedJobTypes: args.allowedJobTypes,
      rateLimitPerMinute: args.rateLimitPerMinute,
    }) as string;
  }
  
  /**
   * Get workers for an organization
   */
  async getWorkers(
    ctx: Pick<QueryCtx, "runQuery">,
    orgId: string
  ): Promise<WorkerInfo[]> {
    return await ctx.runQuery(this.component.workers.getWorkers, { orgId }) as WorkerInfo[];
  }
  

  
  /**
   * Check if there's work available (for use in subscriptions)
   */
  async isThereWork(
    ctx: Pick<QueryCtx, "runQuery">,
    orgId: string,
    capabilities?: string[]
  ): Promise<boolean> {
    return await ctx.runQuery(this.component.workers.isThereWork, { orgId, capabilities });
  }
}

// Re-export types and utilities
export { hashApiKey, generateApiKey, getApiKeyPrefix, verifyApiKey, createHasher } from "../shared/crypto.js";
export type { HashFunction } from "../shared/crypto.js";
export * from "../shared/types.js";
export { config, createConfig } from "../shared/config.js";
export type { Config } from "../shared/config.js";
