import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { workStealing } from "./workStealing";

/**
 * Submit a file for processing
 */
export const submitForProcessing = mutation({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");
    
    // Submit processing job
    const jobId = await workStealing.submitJob(ctx, {
      orgId: file.orgId,
      type: "process-file",
      payload: {
        fileId: args.fileId,
        fileName: file.name,
      },
      requiredCapabilities: ["gpu"],
      priority: 10,
    });
    
    // Update file status
    await ctx.db.patch(args.fileId, {
      status: "processing",
      processingJobId: jobId,
    });
    
    return jobId;
  },
});

/**
 * Get file processing status
 */
export const getProcessingStatus = query({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) return null;
    
    if (!file.processingJobId) {
      return { status: file.status, jobStatus: null };
    }
    
    const jobStatus = await workStealing.getJobStatus(ctx, file.processingJobId);
    
    return {
      status: file.status,
      jobStatus,
    };
  },
});

/**
 * Get queue stats for an organization
 */
export const getOrgQueueStats = query({
  args: {
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    return await workStealing.getQueueStats(ctx, args.orgId);
  },
});
