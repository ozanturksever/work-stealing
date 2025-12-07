import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { config } from "../shared/config.js";
import { jobStatus } from "./schema.js";

/**
 * Submit a single job
 */
export const submitJob = mutation({
  args: {
    orgId: v.string(),
    type: v.string(),
    payload: v.any(),
    priority: v.optional(v.number()),
    requiredCapabilities: v.optional(v.array(v.string())),
    maxRetries: v.optional(v.number()),
    externalId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    batchId: v.optional(v.string()),
    dependsOn: v.optional(v.array(v.string())),
    submittedBy: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("jobs", {
      work: {
        type: args.type,
        payload: args.payload,
        priority: args.priority ?? config.DEFAULT_PRIORITY,
        requiredCapabilities: args.requiredCapabilities,
      },
      orgId: args.orgId,
      status: "pending",
      createdAt: Date.now(),
      lastUpdate: Date.now(),
      retryCount: 0,
      maxRetries: args.maxRetries ?? config.MAX_JOB_RETRIES,
      externalId: args.externalId,
      tags: args.tags,
      batchId: args.batchId,
      dependsOn: args.dependsOn as Id<"jobs">[] | undefined,
      submittedBy: args.submittedBy,
    });
    
    // Record creation
    await ctx.db.insert("jobHistory", {
      jobId,
      event: "created",
      timestamp: Date.now(),
    });
    
    return jobId as string;
  },
});

/**
 * Submit multiple jobs atomically
 */
export const submitJobs = mutation({
  args: {
    orgId: v.string(),
    jobs: v.array(
      v.object({
        type: v.string(),
        payload: v.any(),
        priority: v.optional(v.number()),
        requiredCapabilities: v.optional(v.array(v.string())),
        maxRetries: v.optional(v.number()),
        externalId: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        dependsOn: v.optional(v.array(v.string())),
      })
    ),
    batchId: v.optional(v.string()),
    submittedBy: v.optional(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    if (args.jobs.length > config.MAX_BATCH_SIZE) {
      throw new Error(`Batch size exceeds maximum of ${config.MAX_BATCH_SIZE}`);
    }
    
    const batchId = args.batchId ?? crypto.randomUUID();
    const now = Date.now();
    
    const jobIds = await Promise.all(
      args.jobs.map(async (job) => {
        const jobId = await ctx.db.insert("jobs", {
          work: {
            type: job.type,
            payload: job.payload,
            priority: job.priority ?? config.DEFAULT_PRIORITY,
            requiredCapabilities: job.requiredCapabilities,
          },
          orgId: args.orgId,
          status: "pending",
          createdAt: now,
          lastUpdate: now,
          retryCount: 0,
          maxRetries: job.maxRetries ?? config.MAX_JOB_RETRIES,
          externalId: job.externalId,
          tags: job.tags,
          batchId,
          dependsOn: job.dependsOn as Id<"jobs">[] | undefined,
          submittedBy: args.submittedBy,
        });
        
        await ctx.db.insert("jobHistory", {
          jobId,
          event: "created",
          timestamp: now,
        });
        
        return jobId as string;
      })
    );
    
    return jobIds;
  },
});

/**
 * Get job status by ID
 */
export const getJobStatus = query({
  args: {
    jobId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      status: jobStatus,
      result: v.optional(v.any()),
      error: v.optional(v.string()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      retryCount: v.number(),
      workerId: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId as Id<"jobs">);
    if (!job) return null;
    
    return {
      id: job._id as string,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      retryCount: job.retryCount,
      workerId: job.workerId as string | undefined,
    };
  },
});

/**
 * Get job by external ID
 */
export const getJobByExternalId = query({
  args: {
    externalId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      status: jobStatus,
      result: v.optional(v.any()),
      error: v.optional(v.string()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      retryCount: v.number(),
      workerId: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("externalId", (q) => q.eq("externalId", args.externalId))
      .order("desc")
      .first();
    
    if (!job) return null;
    
    return {
      id: job._id as string,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      retryCount: job.retryCount,
      workerId: job.workerId as string | undefined,
    };
  },
});

/**
 * Get batch status
 */
export const getBatchStatus = query({
  args: {
    batchId: v.string(),
  },
  returns: v.object({
    batchId: v.string(),
    total: v.number(),
    pending: v.number(),
    inProgress: v.number(),
    success: v.number(),
    failed: v.number(),
    timedOut: v.number(),
    cancelled: v.number(),
    jobs: v.array(
      v.object({
        id: v.string(),
        status: jobStatus,
        result: v.optional(v.any()),
        error: v.optional(v.string()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("batchId", (q) => q.eq("batchId", args.batchId))
      .collect();
    
    const counts = {
      pending: 0,
      inProgress: 0,
      success: 0,
      failed: 0,
      timedOut: 0,
      cancelled: 0,
    };
    
    for (const job of jobs) {
      counts[job.status]++;
    }
    
    return {
      batchId: args.batchId,
      total: jobs.length,
      ...counts,
      jobs: jobs.map((j) => ({
        id: j._id as string,
        status: j.status,
        result: j.result,
        error: j.error,
      })),
    };
  },
});

/**
 * Get queue statistics
 */
export const getQueueStats = query({
  args: {
    orgId: v.string(),
  },
  returns: v.object({
    byStatus: v.object({
      pending: v.number(),
      inProgress: v.number(),
      success: v.number(),
      failed: v.number(),
      timedOut: v.number(),
      cancelled: v.number(),
    }),
    totalPending: v.number(),
    totalInProgress: v.number(),
    avgWaitTimeMs: v.number(),
    oldestPendingAge: v.optional(v.number()),
    activeWorkers: v.number(),
    totalWorkers: v.number(),
  }),
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("orgId_status", (q) => q.eq("orgId", args.orgId))
      .collect();
    
    const now = Date.now();
    const counts = {
      pending: 0,
      inProgress: 0,
      success: 0,
      failed: 0,
      timedOut: 0,
      cancelled: 0,
    };
    
    const pendingJobs: Doc<"jobs">[] = [];
    
    for (const job of jobs) {
      counts[job.status]++;
      if (job.status === "pending") {
        pendingJobs.push(job);
      }
    }
    
    const avgWaitTime = pendingJobs.length > 0
      ? pendingJobs.reduce((sum, j) => sum + (now - j.createdAt), 0) / pendingJobs.length
      : 0;
    
    const oldestPending = pendingJobs.length > 0
      ? Math.min(...pendingJobs.map((j) => j.createdAt))
      : undefined;
    
    // Get worker stats
    const workers = await ctx.db
      .query("workers")
      .withIndex("orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    
    const activeWorkers = workers.filter(
      (w) => w.lastSeen && now - w.lastSeen < config.WORKER_STALE_THRESHOLD && !w.revokedAt
    ).length;
    
    return {
      byStatus: counts,
      totalPending: counts.pending,
      totalInProgress: counts.inProgress,
      avgWaitTimeMs: avgWaitTime,
      oldestPendingAge: oldestPending ? now - oldestPending : undefined,
      activeWorkers,
      totalWorkers: workers.filter((w) => !w.revokedAt).length,
    };
  },
});

/**
 * Cancel a job
 */
export const cancelJob = mutation({
  args: {
    jobId: v.string(),
  },
  returns: v.object({
    cancelled: v.boolean(),
    previousStatus: jobStatus,
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId as Id<"jobs">);
    if (!job) throw new Error("Job not found");
    
    const previousStatus = job.status;
    
    if (job.status === "pending" || job.status === "inProgress") {
      if (job.janitorId) {
        await ctx.scheduler.cancel(job.janitorId);
      }
      
      await ctx.db.patch(job._id, {
        status: "cancelled",
        completedAt: Date.now(),
        lastUpdate: Date.now(),
        janitorId: undefined,
      });
      
      await ctx.db.insert("jobHistory", {
        jobId: job._id,
        event: "cancelled",
        timestamp: Date.now(),
      });
      
      return { cancelled: true, previousStatus };
    }
    
    return { cancelled: false, previousStatus };
  },
});

/**
 * Retry a job from dead letter queue
 */
export const retryDeadLetter = mutation({
  args: {
    deadLetterId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const dlJob = await ctx.db.get(args.deadLetterId as Id<"deadLetterJobs">);
    if (!dlJob) throw new Error("Dead letter job not found");
    
    const jobId = await ctx.db.insert("jobs", {
      work: dlJob.work,
      orgId: dlJob.orgId,
      status: "pending",
      createdAt: Date.now(),
      lastUpdate: Date.now(),
      retryCount: 0,
      maxRetries: config.MAX_JOB_RETRIES,
      tags: ["retry-from-dlq"],
      previousJobId: dlJob.originalJobId,
    });
    
    await ctx.db.insert("jobHistory", {
      jobId,
      event: "retried",
      timestamp: Date.now(),
      details: { fromDLQ: true, originalJobId: dlJob.originalJobId },
    });
    
    await ctx.db.delete(dlJob._id);
    
    return jobId as string;
  },
});

/**
 * Get dead letter jobs
 */
export const getDeadLetterJobs = query({
  args: {
    orgId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      originalJobId: v.string(),
      type: v.string(),
      error: v.optional(v.string()),
      retryCount: v.number(),
      movedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("deadLetterJobs")
      .withIndex("orgId", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(args.limit ?? 50);
    
    return jobs.map((j) => ({
      id: j._id as string,
      originalJobId: j.originalJobId as string,
      type: j.work.type,
      error: j.error,
      retryCount: j.retryCount,
      movedAt: j.movedAt,
    }));
  },
});
