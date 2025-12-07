import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { workStealing } from "./workStealing";

/**
 * Register a new worker
 */
export const registerWorker = mutation({
  args: {
    name: v.string(),
    orgId: v.string(),
    capabilities: v.array(v.string()),
    maxConcurrentJobs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // In a real app, you'd verify the current user is an admin
    const result = await workStealing.registerWorker(ctx, {
      name: args.name,
      orgId: args.orgId,
      allowedCapabilities: args.capabilities,
      maxConcurrentJobs: args.maxConcurrentJobs ?? 1,
      createdBy: "admin", // In real app, use actual admin ID
    });
    
    return {
      workerId: result.workerId,
      apiKeyPrefix: result.apiKeyPrefix,
      // IMPORTANT: Only show the full API key once!
      apiKey: result.apiKey,
    };
  },
});

/**
 * List workers for an organization
 */
export const listWorkers = query({
  args: {
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    return await workStealing.getWorkers(ctx, args.orgId);
  },
});

/**
 * Get dead letter jobs
 */
export const getFailedJobs = query({
  args: {
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    return await workStealing.getDeadLetterJobs(ctx, args.orgId);
  },
});

/**
 * Retry a failed job
 */
export const retryFailedJob = mutation({
  args: {
    deadLetterId: v.string(),
  },
  handler: async (ctx, args) => {
    return await workStealing.retryDeadLetter(ctx, args.deadLetterId);
  },
});
