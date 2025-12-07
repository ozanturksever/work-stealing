import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { config } from "../shared/config.js";

/**
 * Hash an API key using SHA-256 (internal utility)
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Authenticate a worker by API key and return worker context
 */
async function authenticateWorker(
  ctx: { db: { query: Function; patch: Function } },
  apiKey: string
): Promise<Doc<"workers">> {
  const keyHash = await hashApiKey(apiKey);
  
  const worker = await ctx.db
    .query("workers")
    .withIndex("apiKeyHash", (q: any) => q.eq("apiKeyHash", keyHash))
    .unique();
  
  if (!worker) {
    throw new Error("Invalid API key");
  }
  
  if (worker.revokedAt) {
    throw new Error("API key has been revoked");
  }
  
  if (worker.expiresAt && worker.expiresAt < Date.now()) {
    throw new Error("API key has expired");
  }
  
  // Update last seen
  await ctx.db.patch(worker._id, { lastSeen: Date.now() });
  
  return worker;
}

/**
 * Check if there's work available (for reactive subscriptions)
 */
export const isThereWork = query({
  args: {
    orgId: v.string(),
    capabilities: v.optional(v.array(v.string())),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const pendingJobs = await ctx.db
      .query("jobs")
      .withIndex("orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "pending")
      )
      .take(5);
    
    if (pendingJobs.length === 0) return false;
    
    // If capabilities specified, check if any job matches
    if (args.capabilities && args.capabilities.length > 0) {
      return pendingJobs.some((job) => {
        if (!job.work.requiredCapabilities) return true;
        return job.work.requiredCapabilities.every((cap) =>
          args.capabilities!.includes(cap)
        );
      });
    }
    
    return true;
  },
});

/**
 * Claim work atomically - main worker endpoint
 */
export const giveMeWork = mutation({
  args: {
    apiKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.string(),
      type: v.string(),
      payload: v.any(),
      priority: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const worker = await authenticateWorker(ctx, args.apiKey);
    
    // Check concurrent job limit
    const currentJobs = await ctx.db
      .query("jobs")
      .withIndex("workerId", (q) =>
        q.eq("workerId", worker._id).eq("status", "inProgress")
      )
      .collect();
    
    if (currentJobs.length >= worker.maxConcurrentJobs) {
      return null;
    }
    
    // Query pending jobs for this org only (tenant isolation)
    const pendingJobs = await ctx.db
      .query("jobs")
      .withIndex("orgId_status", (q) =>
        q.eq("orgId", worker.orgId).eq("status", "pending")
      )
      .take(config.WORK_FETCH_LIMIT);
    
    // Find job matching worker's capabilities
    const job = pendingJobs.find((j) => {
      // Check job type whitelist if configured
      if (worker.allowedJobTypes && !worker.allowedJobTypes.includes(j.work.type)) {
        return false;
      }
      
      // Check priority range if configured
      if (worker.allowedPriorities) {
        const priority = j.work.priority ?? config.DEFAULT_PRIORITY;
        if (priority < worker.allowedPriorities.min || priority > worker.allowedPriorities.max) {
          return false;
        }
      }
      
      // Check capability requirements
      if (j.work.requiredCapabilities && j.work.requiredCapabilities.length > 0) {
        const hasAll = j.work.requiredCapabilities.every((cap) =>
          worker.allowedCapabilities.includes(cap)
        );
        if (!hasAll) return false;
      }
      
      // Check denied capabilities
      if (worker.deniedCapabilities && j.work.requiredCapabilities) {
        const hasDenied = j.work.requiredCapabilities.some((cap) =>
          worker.deniedCapabilities!.includes(cap)
        );
        if (hasDenied) return false;
      }
      
      // Check dependencies
      if (j.dependsOn && j.dependsOn.length > 0) {
        // Skip jobs with unmet dependencies (checked later)
        return false;
      }
      
      return true;
    });
    
    if (!job) {
      // Check if there are jobs with dependencies that might be ready
      const jobWithDeps = await findJobWithSatisfiedDeps(ctx, pendingJobs, worker);
      if (!jobWithDeps) return null;
      return await claimJob(ctx, jobWithDeps, worker);
    }
    
    return await claimJob(ctx, job, worker);
  },
});

async function findJobWithSatisfiedDeps(
  ctx: any,
  jobs: Doc<"jobs">[],
  worker: Doc<"workers">
): Promise<Doc<"jobs"> | null> {
  for (const job of jobs) {
    if (!job.dependsOn || job.dependsOn.length === 0) continue;
    
    // Check all dependencies are complete
    const deps = await Promise.all(
      job.dependsOn.map((id) => ctx.db.get(id))
    );
    
    if (deps.every((d: Doc<"jobs"> | null) => d?.status === "success")) {
      // Check capabilities
      if (job.work.requiredCapabilities) {
        const hasAll = job.work.requiredCapabilities.every((cap) =>
          worker.allowedCapabilities.includes(cap)
        );
        if (!hasAll) continue;
      }
      return job;
    }
  }
  return null;
}

async function claimJob(
  ctx: any,
  job: Doc<"jobs">,
  worker: Doc<"workers">
): Promise<{ jobId: string; type: string; payload: unknown; priority?: number }> {
  // Schedule janitor for timeout detection
  const janitorId = await ctx.scheduler.runAfter(
    config.WORKER_DEAD_TIMEOUT,
    internal.internal.markAsDead,
    { jobId: job._id }
  );
  
  // Claim the job atomically
  await ctx.db.patch(job._id, {
    status: "inProgress",
    workerId: worker._id,
    startedAt: Date.now(),
    lastUpdate: Date.now(),
    janitorId,
  });
  
  // Record history
  await ctx.db.insert("jobHistory", {
    jobId: job._id,
    event: "claimed",
    timestamp: Date.now(),
    workerId: worker._id,
    workerOrgId: worker.orgId,
    workerName: worker.name,
  });
  
  return {
    jobId: job._id as string,
    type: job.work.type,
    payload: job.work.payload,
    priority: job.work.priority,
  };
}

/**
 * Heartbeat to indicate worker is still processing
 */
export const imStillWorking = mutation({
  args: {
    apiKey: v.string(),
    jobId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const worker = await authenticateWorker(ctx, args.apiKey);
    const jobId = args.jobId as Id<"jobs">;
    
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "inProgress") throw new Error("Job not in progress");
    if (job.workerId !== worker._id) throw new Error("Job not assigned to this worker");
    
    // Cancel old janitor and schedule new one
    if (job.janitorId) {
      await ctx.scheduler.cancel(job.janitorId);
    }
    
    const janitorId = await ctx.scheduler.runAfter(
      config.WORKER_DEAD_TIMEOUT,
      internal.internal.markAsDead,
      { jobId: job._id }
    );
    
    await ctx.db.patch(job._id, {
      lastUpdate: Date.now(),
      janitorId,
    });
    
    return null;
  },
});

/**
 * Submit result and optionally claim next job
 */
export const submitResult = mutation({
  args: {
    apiKey: v.string(),
    jobId: v.string(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    state: v.union(
      v.literal("streaming"),
      v.literal("success"),
      v.literal("failed")
    ),
  },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.string(),
      type: v.string(),
      payload: v.any(),
      priority: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const worker = await authenticateWorker(ctx, args.apiKey);
    const jobId = args.jobId as Id<"jobs">;
    
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "inProgress") throw new Error("Job not in progress");
    if (job.workerId !== worker._id) throw new Error("Job not assigned to this worker");
    
    if (args.state === "streaming") {
      // Partial update - job continues
      await ctx.db.patch(jobId, {
        result: args.result,
        lastUpdate: Date.now(),
      });
      return null;
    }
    
    // Final state - cancel janitor
    if (job.janitorId) {
      await ctx.scheduler.cancel(job.janitorId);
    }
    
    const completedAt = Date.now();
    const duration = job.startedAt ? completedAt - job.startedAt : undefined;
    
    await ctx.db.patch(jobId, {
      status: args.state,
      result: args.result,
      error: args.error,
      completedAt,
      lastUpdate: completedAt,
      janitorId: undefined,
    });
    
    // Record completion
    await ctx.db.insert("jobHistory", {
      jobId: jobId,
      event: args.state === "success" ? "completed" : "failed",
      timestamp: completedAt,
      workerId: worker._id,
      workerOrgId: worker.orgId,
      workerName: worker.name,
      duration,
      details: args.error ? { error: args.error } : undefined,
    });
    
    // Handle retry for failures
    if (args.state === "failed") {
      if (job.retryCount < job.maxRetries) {
        const backoff = Math.min(
          config.RETRY_BACKOFF_BASE * Math.pow(2, job.retryCount),
          config.MAX_RETRY_BACKOFF
        );
        
        await ctx.scheduler.runAfter(
          backoff,
          internal.internal.requeueJob,
          { jobId: job._id, retryCount: job.retryCount + 1 }
        );
      } else {
        // Move to dead letter queue
        await ctx.scheduler.runAfter(
          0,
          internal.internal.moveToDeadLetter,
          { jobId: job._id }
        );
      }
    }
    
    // Try to claim next job atomically
    return await claimNextJob(ctx, worker);
  },
});

async function claimNextJob(
  ctx: any,
  worker: Doc<"workers">
): Promise<{ jobId: string; type: string; payload: unknown; priority?: number } | null> {
  // Check concurrent job limit
  const currentJobs = await ctx.db
    .query("jobs")
    .withIndex("workerId", (q: any) =>
      q.eq("workerId", worker._id).eq("status", "inProgress")
    )
    .collect();
  
  if (currentJobs.length >= worker.maxConcurrentJobs) {
    return null;
  }
  
  // Find next pending job
  const pendingJobs = await ctx.db
    .query("jobs")
    .withIndex("orgId_status", (q: any) =>
      q.eq("orgId", worker.orgId).eq("status", "pending")
    )
    .take(config.WORK_FETCH_LIMIT);
  
  const job = pendingJobs.find((j: Doc<"jobs">) => {
    if (worker.allowedJobTypes && !worker.allowedJobTypes.includes(j.work.type)) {
      return false;
    }
    if (j.work.requiredCapabilities) {
      return j.work.requiredCapabilities.every((cap) =>
        worker.allowedCapabilities.includes(cap)
      );
    }
    return true;
  });
  
  if (!job) return null;
  
  return await claimJob(ctx, job, worker);
}

/**
 * Register a new worker with pre-hashed API key
 * This allows integration with better-auth or other external key management
 */
export const registerWorkerWithHash = mutation({
  args: {
    apiKeyHash: v.string(),
    apiKeyPrefix: v.string(),
    name: v.string(),
    orgId: v.string(),
    allowedCapabilities: v.array(v.string()),
    maxConcurrentJobs: v.number(),
    createdBy: v.string(),
    expiresAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
    allowedJobTypes: v.optional(v.array(v.string())),
    deniedCapabilities: v.optional(v.array(v.string())),
    rateLimitPerMinute: v.optional(v.number()),
    allowedPriorities: v.optional(v.object({
      min: v.number(),
      max: v.number(),
    })),
  },
  returns: v.id("workers"),
  handler: async (ctx, args) => {
    const workerId = await ctx.db.insert("workers", {
      apiKeyHash: args.apiKeyHash,
      apiKeyPrefix: args.apiKeyPrefix,
      name: args.name,
      orgId: args.orgId,
      allowedCapabilities: args.allowedCapabilities,
      maxConcurrentJobs: args.maxConcurrentJobs,
      createdBy: args.createdBy,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      metadata: args.metadata,
      allowedJobTypes: args.allowedJobTypes,
      deniedCapabilities: args.deniedCapabilities,
      rateLimitPerMinute: args.rateLimitPerMinute,
      allowedPriorities: args.allowedPriorities,
    });
    
    return workerId;
  },
});

/**
 * Get workers list for an organization
 */
export const getWorkers = query({
  args: {
    orgId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      status: v.string(),
      capabilities: v.array(v.string()),
      maxConcurrentJobs: v.number(),
      currentJobCount: v.number(),
      lastSeen: v.optional(v.number()),
      createdAt: v.number(),
      expiresAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const workers = await ctx.db
      .query("workers")
      .withIndex("orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    
    const now = Date.now();
    
    const workersWithJobs = await Promise.all(
      workers.map(async (w) => {
        const inProgressJobs = await ctx.db
          .query("jobs")
          .withIndex("workerId", (q) =>
            q.eq("workerId", w._id).eq("status", "inProgress")
          )
          .collect();
        
        let status: string;
        if (w.revokedAt) {
          status = "revoked";
        } else if (w.expiresAt && w.expiresAt < now) {
          status = "expired";
        } else if (!w.lastSeen || now - w.lastSeen > config.WORKER_STALE_THRESHOLD) {
          status = "stale";
        } else {
          status = "active";
        }
        
        return {
          id: w._id as string,
          name: w.name,
          status,
          capabilities: w.allowedCapabilities,
          maxConcurrentJobs: w.maxConcurrentJobs,
          currentJobCount: inProgressJobs.length,
          lastSeen: w.lastSeen,
          createdAt: w.createdAt,
          expiresAt: w.expiresAt,
        };
      })
    );
    
    return workersWithJobs;
  },
});
