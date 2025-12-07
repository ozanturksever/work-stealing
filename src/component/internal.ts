import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { config } from "../shared/config.js";

/**
 * Mark a job as timed out (called by janitor scheduler)
 */
export const markAsDead = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "inProgress") return null;
    
    await ctx.db.patch(args.jobId, {
      status: "timedOut",
      error: "Worker stopped responding",
      completedAt: Date.now(),
      lastUpdate: Date.now(),
    });
    
    // Record timeout
    await ctx.db.insert("jobHistory", {
      jobId: args.jobId,
      event: "timedOut",
      timestamp: Date.now(),
      workerId: job.workerId,
    });
    
    // Schedule retry if under limit
    if (job.retryCount < job.maxRetries) {
      const backoff = Math.min(
        config.RETRY_BACKOFF_BASE * Math.pow(2, job.retryCount),
        config.MAX_RETRY_BACKOFF
      );
      
      await ctx.scheduler.runAfter(
        backoff,
        internal.internal.requeueJob,
        { jobId: args.jobId, retryCount: job.retryCount + 1 }
      );
    } else {
      // Move to dead letter queue
      await ctx.scheduler.runAfter(
        0,
        internal.internal.moveToDeadLetter,
        { jobId: args.jobId }
      );
    }
    
    return null;
  },
});

/**
 * Requeue a failed/timed-out job
 */
export const requeueJob = internalMutation({
  args: {
    jobId: v.id("jobs"),
    retryCount: v.number(),
  },
  returns: v.union(v.null(), v.id("jobs")),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    
    // Create new job as retry
    const newJobId = await ctx.db.insert("jobs", {
      work: job.work,
      orgId: job.orgId,
      status: "pending",
      createdAt: Date.now(),
      lastUpdate: Date.now(),
      retryCount: args.retryCount,
      maxRetries: job.maxRetries,
      previousJobId: job._id,
      externalId: job.externalId,
      tags: job.tags,
      batchId: job.batchId,
      submittedBy: job.submittedBy,
    });
    
    await ctx.db.insert("jobHistory", {
      jobId: newJobId,
      event: "retried",
      timestamp: Date.now(),
      details: { originalJobId: args.jobId, retryCount: args.retryCount },
    });
    
    return newJobId;
  },
});

/**
 * Move a job to the dead letter queue
 */
export const moveToDeadLetter = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    
    await ctx.db.insert("deadLetterJobs", {
      originalJobId: job._id,
      orgId: job.orgId,
      work: job.work,
      error: job.error,
      retryCount: job.retryCount,
      createdAt: job.createdAt,
      movedAt: Date.now(),
      lastWorkerId: job.workerId,
    });
    
    await ctx.db.insert("jobHistory", {
      jobId: job._id,
      event: "movedToDLQ",
      timestamp: Date.now(),
      details: { retryCount: job.retryCount, error: job.error },
    });
    
    return null;
  },
});

/**
 * Revoke a worker (instant effect)
 */
export const revokeWorker = internalMutation({
  args: {
    workerId: v.id("workers"),
    revokedBy: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    revoked: v.boolean(),
    jobsReassigned: v.number(),
  }),
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker) throw new Error("Worker not found");
    
    // Mark as revoked
    await ctx.db.patch(args.workerId, {
      revokedAt: Date.now(),
      revokedBy: args.revokedBy,
    });
    
    // Cancel all in-progress jobs and return them to pending
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("workerId", (q) =>
        q.eq("workerId", args.workerId).eq("status", "inProgress")
      )
      .collect();
    
    for (const job of jobs) {
      if (job.janitorId) {
        await ctx.scheduler.cancel(job.janitorId);
      }
      
      await ctx.db.patch(job._id, {
        status: "pending",
        workerId: undefined,
        janitorId: undefined,
        startedAt: undefined,
        lastUpdate: Date.now(),
      });
    }
    
    return { revoked: true, jobsReassigned: jobs.length };
  },
});

/**
 * Rotate a worker's API key
 */
export const rotateWorkerKey = internalMutation({
  args: {
    workerId: v.id("workers"),
    newApiKeyHash: v.string(),
    newApiKeyPrefix: v.string(),
    rotatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker) throw new Error("Worker not found");
    
    await ctx.db.patch(args.workerId, {
      apiKeyHash: args.newApiKeyHash,
      apiKeyPrefix: args.newApiKeyPrefix,
      metadata: {
        ...(worker.metadata as Record<string, unknown> ?? {}),
        lastRotated: Date.now(),
        rotatedBy: args.rotatedBy,
      },
    });
    
    return null;
  },
});

/**
 * Cleanup old completed jobs
 */
export const cleanupOldJobs = internalMutation({
  args: {
    maxAge: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    jobsDeleted: v.number(),
    historyDeleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.maxAge ?? config.COMPLETED_JOB_TTL);
    const limit = args.limit ?? 100;
    
    const oldJobs = await ctx.db
      .query("jobs")
      .withIndex("createdAt")
      .filter((q) =>
        q.and(
          q.lt(q.field("createdAt"), cutoff),
          q.or(
            q.eq(q.field("status"), "success"),
            q.eq(q.field("status"), "failed"),
            q.eq(q.field("status"), "timedOut"),
            q.eq(q.field("status"), "cancelled")
          )
        )
      )
      .take(limit);
    
    let historyDeleted = 0;
    
    for (const job of oldJobs) {
      // Delete associated history
      const history = await ctx.db
        .query("jobHistory")
        .withIndex("jobId", (q) => q.eq("jobId", job._id))
        .collect();
      
      for (const h of history) {
        await ctx.db.delete(h._id);
        historyDeleted++;
      }
      
      await ctx.db.delete(job._id);
    }
    
    return { jobsDeleted: oldJobs.length, historyDeleted };
  },
});

/**
 * Cleanup old dead letter jobs
 */
export const cleanupDeadLetterJobs = internalMutation({
  args: {
    maxAge: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.maxAge ?? config.DEAD_LETTER_TTL);
    const limit = args.limit ?? 100;
    
    const oldDLJobs = await ctx.db
      .query("deadLetterJobs")
      .withIndex("movedAt")
      .filter((q) => q.lt(q.field("movedAt"), cutoff))
      .take(limit);
    
    for (const job of oldDLJobs) {
      await ctx.db.delete(job._id);
    }
    
    return oldDLJobs.length;
  },
});

/**
 * Revoke all workers in an organization
 */
export const revokeOrgWorkers = internalMutation({
  args: {
    orgId: v.string(),
    revokedBy: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const workers = await ctx.db
      .query("workers")
      .withIndex("orgId", (q) => q.eq("orgId", args.orgId))
      .filter((q) => q.eq(q.field("revokedAt"), undefined))
      .collect();
    
    for (const worker of workers) {
      await ctx.db.patch(worker._id, {
        revokedAt: Date.now(),
        revokedBy: args.revokedBy,
      });
    }
    
    return workers.length;
  },
});
