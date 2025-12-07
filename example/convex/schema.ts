import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    orgId: v.string(),
  }).index("email", ["email"]),
  
  files: defineTable({
    name: v.string(),
    orgId: v.string(),
    status: v.string(),
    processingJobId: v.optional(v.string()),
  }).index("orgId", ["orgId"]),
});
