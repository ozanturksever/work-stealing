import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Job status values
 */
export const jobStatus = v.union(
  v.literal("pending"),
  v.literal("inProgress"),
  v.literal("success"),
  v.literal("failed"),
  v.literal("timedOut"),
  v.literal("cancelled")
);

/**
 * Job history event types
 */
export const jobEvent = v.union(
  v.literal("created"),
  v.literal("claimed"),
  v.literal("heartbeat"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("timedOut"),
  v.literal("retried"),
  v.literal("cancelled"),
  v.literal("movedToDLQ")
);

/**
 * Work specification validator
 */
export const workSpec = v.object({
  type: v.string(),
  payload: v.any(),
  priority: v.optional(v.number()),
  requiredCapabilities: v.optional(v.array(v.string())),
});

export default defineSchema({
  /**
   * Workers table - stores CLI worker registrations with multi-tenant support
   * 
   * Authentication uses hashed API keys (compatible with better-auth but not dependent)
   * All capability and limit fields are server-controlled - CLI cannot modify them
   */
  workers: defineTable({
    // Authentication (better-auth compatible pattern)
    apiKeyHash: v.string(),
    apiKeyPrefix: v.string(),
    
    // Multi-Tenant Isolation (server-controlled)
    orgId: v.string(),
    tenantId: v.optional(v.string()),
    
    // Capability Restrictions (server-controlled)
    allowedCapabilities: v.array(v.string()),
    deniedCapabilities: v.optional(v.array(v.string())),
    
    // Resource Limits (server-controlled)
    maxConcurrentJobs: v.number(),
    rateLimitPerMinute: v.optional(v.number()),
    
    // Access Control (server-controlled)
    allowedJobTypes: v.optional(v.array(v.string())),
    allowedPriorities: v.optional(v.object({
      min: v.number(),
      max: v.number(),
    })),
    
    // Audit & Identity
    name: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    lastSeen: v.optional(v.number()),
    
    // Lifecycle
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.string()),
    
    // Metadata (flexible, server-controlled)
    metadata: v.optional(v.any()),
  })
    .index("apiKeyHash", ["apiKeyHash"])
    .index("apiKeyPrefix", ["apiKeyPrefix"])
    .index("orgId", ["orgId", "revokedAt"])
    .index("orgId_lastSeen", ["orgId", "lastSeen"]),

  /**
   * Jobs table - stores work items with multi-tenant isolation
   */
  jobs: defineTable({
    // Work specification
    work: workSpec,
    
    // Multi-Tenant Isolation
    orgId: v.string(),
    
    // Status tracking
    status: jobStatus,
    
    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastUpdate: v.number(),
    
    // Assignment
    workerId: v.optional(v.id("workers")),
    janitorId: v.optional(v.id("_scheduled_functions")),
    
    // Results
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    
    // Retry tracking
    retryCount: v.number(),
    maxRetries: v.number(),
    previousJobId: v.optional(v.id("jobs")),
    
    // Metadata
    submittedBy: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    externalId: v.optional(v.string()),
    batchId: v.optional(v.string()),
    
    // Dependencies
    dependsOn: v.optional(v.array(v.id("jobs"))),
  })
    .index("orgId_status", ["orgId", "status", "createdAt"])
    .index("orgId_status_priority", ["orgId", "status"])
    .index("workerId", ["workerId", "status"])
    .index("externalId", ["externalId"])
    .index("batchId", ["batchId"])
    .index("createdAt", ["createdAt"])
    .index("status", ["status", "createdAt"]),

  /**
   * Job history table - audit trail for analytics and debugging
   */
  jobHistory: defineTable({
    jobId: v.id("jobs"),
    event: jobEvent,
    timestamp: v.number(),
    workerId: v.optional(v.id("workers")),
    workerOrgId: v.optional(v.string()),
    workerName: v.optional(v.string()),
    details: v.optional(v.any()),
    duration: v.optional(v.number()),
  })
    .index("jobId", ["jobId", "timestamp"])
    .index("timestamp", ["timestamp"])
    .index("workerId", ["workerId", "timestamp"]),

  /**
   * Dead letter jobs - failed jobs that exceeded retry limits
   */
  deadLetterJobs: defineTable({
    originalJobId: v.id("jobs"),
    orgId: v.string(),
    work: workSpec,
    error: v.optional(v.string()),
    retryCount: v.number(),
    createdAt: v.number(),
    movedAt: v.number(),
    lastWorkerId: v.optional(v.id("workers")),
  })
    .index("orgId", ["orgId", "movedAt"])
    .index("movedAt", ["movedAt"]),
});
