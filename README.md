# @fatagnus/work-stealing

A Convex component for building distributed systems where CLI workers running on client machines are coordinated by a central Convex backend using the work-stealing pattern.

## Features

- **Multi-tenant isolation**: Workers and jobs are scoped to organizations
- **Capability-based routing**: Route jobs to workers with specific capabilities
- **Atomic job claiming**: Prevents double-processing using Convex transactions
- **Heartbeat & timeout detection**: Automatically handles worker failures
- **Streaming results**: Send partial results during processing
- **Retry with backoff**: Configurable retry logic with exponential backoff
- **Dead letter queue**: Failed jobs are preserved for investigation
- **API key authentication**: Secure, hashed API keys (better-auth compatible)
- **Priority queuing**: Process urgent jobs first

## Installation

```bash
npm install @fatagnus/work-stealing
```

## Setup

### 1. Configure the component

In your `convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import workStealing from "@fatagnus/work-stealing/convex.config";

const app = defineApp();
app.use(workStealing);
export default app;
```

### 2. Create a client in your app

```typescript
// convex/workStealing.ts
import { WorkStealingClient } from "@fatagnus/work-stealing/client";
import { components } from "./_generated/api";

export const workStealing = new WorkStealingClient(components.workStealing);
```

### 3. Submit jobs

```typescript
// convex/myFunctions.ts
import { mutation } from "./_generated/server";
import { workStealing } from "./workStealing";

export const submitProcessingJob = mutation({
  args: { fileId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    const jobId = await workStealing.submitJob(ctx, {
      orgId: user.orgId,
      type: "process-file",
      payload: { fileId: args.fileId },
      requiredCapabilities: ["gpu"],
    });
    
    return jobId;
  },
});
```

### 4. Register a worker

```typescript
// convex/admin.ts
import { mutation } from "./_generated/server";
import { workStealing } from "./workStealing";

export const registerWorker = mutation({
  args: {
    name: v.string(),
    capabilities: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await getCurrentAdmin(ctx);
    
    const result = await workStealing.registerWorker(ctx, {
      name: args.name,
      orgId: admin.orgId,
      allowedCapabilities: args.capabilities,
      maxConcurrentJobs: 2,
      createdBy: admin._id,
    });
    
    // result.apiKey - Show this ONCE to the admin
    return result;
  },
});
```

### 5. Create a CLI worker

```typescript
// cli-worker/index.ts
import { ConvexClient } from "convex/browser";
import { Worker } from "@fatagnus/work-stealing/client/worker";
import { api, components } from "../convex/_generated/api";

const client = new ConvexClient(process.env.CONVEX_URL!);

const worker = new Worker(client, {
  apiKey: process.env.WORKER_API_KEY!,
  api: components.workStealing,
  handlers: {
    "process-file": async (payload, ctx) => {
      const { fileId } = payload as { fileId: string };
      
      // Send progress updates
      await ctx.sendProgress({ status: "loading", progress: 0 });
      
      // Do the actual processing
      const result = await processFile(fileId);
      
      return { success: true, result };
    },
  },
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await worker.stop();
  process.exit(0);
});

await worker.start();
```

## API Reference

### WorkStealingClient

#### Job Methods

- `submitJob(ctx, args)` - Submit a single job
- `submitJobs(ctx, args)` - Submit multiple jobs atomically
- `cancelJob(ctx, jobId)` - Cancel a pending/in-progress job
- `getJobStatus(ctx, jobId)` - Get job status by ID
- `getJobByExternalId(ctx, externalId)` - Get job by external correlation ID
- `getBatchStatus(ctx, batchId)` - Get status of a batch of jobs
- `getQueueStats(ctx, orgId)` - Get queue statistics
- `getDeadLetterJobs(ctx, orgId, limit?)` - Get failed jobs from DLQ
- `retryDeadLetter(ctx, deadLetterId)` - Retry a job from DLQ

#### Worker Methods

- `registerWorker(ctx, args)` - Register a new worker and get API key
- `registerWorkerWithHash(ctx, args)` - Register with pre-hashed key (better-auth)
- `getWorkers(ctx, orgId)` - List workers for an organization
- `isThereWork(ctx, orgId, capabilities?)` - Check if work is available

### Worker (CLI)

- `new Worker(client, config)` - Create a worker instance
- `worker.start()` - Start processing jobs
- `worker.stop()` - Stop gracefully (finishes current job)

## Configuration

```typescript
import { WorkStealingClient, createConfig } from "@fatagnus/work-stealing/client";

const workStealing = new WorkStealingClient(components.workStealing, {
  // Custom API key prefix
  apiKeyPrefix: "sk_myapp_",
  
  // Custom hash function (for better-auth integration)
  hashApiKey: myCustomHashFunction,
  
  // Override default config values
  config: createConfig({
    WORKER_DEAD_TIMEOUT: 120_000, // 2 minutes
    MAX_JOB_RETRIES: 5,
  }),
});
```

## better-auth Integration

This component is designed to work with better-auth's API key plugin, but does not depend on it:

```typescript
import { auth } from "./auth"; // Your better-auth instance
import { WorkStealingClient } from "@fatagnus/work-stealing/client";

// Create API key with better-auth
const { key, id } = await auth.api.createKey({
  name: "Worker GPU-1",
  scopes: ["gpu", "inference"],
  metadata: { orgId: user.orgId },
});

// Register worker with pre-hashed key
const workerId = await workStealing.registerWorkerWithHash(ctx, {
  apiKeyHash: await hashApiKey(key), // Use your better-auth hash function
  apiKeyPrefix: key.substring(0, 12),
  name: "GPU Worker 1",
  orgId: user.orgId,
  allowedCapabilities: ["gpu", "inference"],
  maxConcurrentJobs: 2,
  createdBy: user._id,
});
```

## Security

- API keys are stored as hashes (never plain text)
- All metadata (orgId, capabilities, limits) is server-controlled
- Workers cannot see or claim jobs from other organizations
- Instant revocation via database update
- Audit trail for all job events

## License

Apache-2.0
