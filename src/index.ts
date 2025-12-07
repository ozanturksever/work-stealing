/**
 * work-stealing
 * 
 * Work-stealing pattern for distributed CLI workers coordinated by Convex.
 * 
 * @example
 * ```ts
 * // In your convex/convex.config.ts:
 * import { defineApp } from "convex/server";
 * import workStealing from "work-stealing/convex.config";
 * 
 * const app = defineApp();
 * app.use(workStealing);
 * export default app;
 * 
 * // In your app code:
 * import { WorkStealingClient } from "work-stealing/client";
 * import { components } from "./_generated/api";
 * 
 * const workStealing = new WorkStealingClient(components.workStealing);
 * ```
 */

// Re-export the component config
export { default as componentConfig } from "./component/convex.config.js";

// Re-export types
export type {
  JobStatus,
  JobEvent,
  WorkSpec,
  SubmitJobArgs,
  SubmitBatchArgs,
  RegisterWorkerArgs,
  RegisterWorkerResult,
  JobStatusResponse,
  BatchStatusResponse,
  WorkerStatus,
  WorkerInfo,
  QueueStats,
  WorkItem,
  ResultState,
  JobHandler,
  JobContext,
  WorkerConfig,
} from "./shared/types.js";

// Re-export config
export { config, createConfig } from "./shared/config.js";
export type { Config } from "./shared/config.js";

// Re-export crypto utilities
export {
  hashApiKey,
  generateApiKey,
  getApiKeyPrefix,
  verifyApiKey,
  createHasher,
} from "./shared/crypto.js";
export type { HashFunction } from "./shared/crypto.js";
