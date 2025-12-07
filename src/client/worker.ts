import type { WorkerConfig, JobHandler, JobContext, WorkItem, ResultState } from "../shared/types.js";
import { config as defaultConfig } from "../shared/config.js";

/**
 * Convex client interface (compatible with ConvexClient from convex/browser)
 */
interface ConvexClientInterface {
  mutation<Args, Result>(fn: any, args: Args): Promise<Result>;
  onUpdate<Args, Result>(
    fn: any,
    args: Args,
    callback: (result: Result) => void,
    onError?: (error: Error) => void
  ): () => void;
  close(): Promise<void>;
}

/**
 * CLI Worker that connects to Convex and processes jobs.
 * 
 * @example
 * ```ts
 * import { Worker } from "@fatagnus/work-stealing/client/worker";
 * import { ConvexClient } from "convex/browser";
 * 
 * const client = new ConvexClient(process.env.CONVEX_URL!);
 * 
 * const worker = new Worker(client, {
 *   apiKey: process.env.WORKER_API_KEY!,
 *   handlers: {
 *     "process-file": async (payload, ctx) => {
 *       // Process the file
 *       await ctx.sendProgress({ status: "processing" });
 *       return { success: true };
 *     },
 *   },
 * });
 * 
 * await worker.start();
 * ```
 */
export class Worker {
  private client: ConvexClientInterface;
  private apiKey: string;
  private handlers: Record<string, JobHandler>;
  private heartbeatInterval: number;
  private running = false;
  private currentJob: { id: string; heartbeat: ReturnType<typeof setInterval> } | null = null;
  private onError?: (error: Error, jobId?: string) => void;
  private onJobStart?: (jobId: string, type: string) => void;
  private onJobComplete?: (jobId: string, type: string, duration: number) => void;
  
  // API references - these need to be provided by the user since we don't have generated types
  private api: {
    workers: {
      isThereWork: any;
      giveMeWork: any;
      imStillWorking: any;
      submitResult: any;
    };
  };
  
  constructor(
    client: ConvexClientInterface,
    config: WorkerConfig & { api: typeof Worker.prototype.api }
  ) {
    this.client = client;
    this.apiKey = config.apiKey;
    this.handlers = config.handlers;
    this.heartbeatInterval = config.heartbeatInterval ?? defaultConfig.WORKER_HEARTBEAT_INTERVAL;
    this.onError = config.onError;
    this.onJobStart = config.onJobStart;
    this.onJobComplete = config.onJobComplete;
    this.api = config.api;
  }
  
  /**
   * Start the worker loop
   */
  async start(): Promise<void> {
    this.running = true;
    console.log("Worker starting...");
    
    while (this.running) {
      try {
        await this.waitForWork();
        await this.processWork();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error("Error in work loop:", err);
        this.onError?.(err);
        // Back off on errors
        await this.sleep(5000);
      }
    }
  }
  
  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    this.running = false;
    
    if (this.currentJob) {
      console.log("Finishing current job before shutdown...");
      
      // Wait up to 30 seconds for current job
      const timeout = setTimeout(() => {
        console.log("Timeout waiting for job, forcing shutdown");
        process.exit(1);
      }, 30000);
      
      // Wait for job to complete
      while (this.currentJob) {
        await this.sleep(100);
      }
      
      clearTimeout(timeout);
    }
    
    await this.client.close();
    console.log("Worker shut down gracefully");
  }
  
  /**
   * Wait for work using polling (simplified approach)
   */
  private async waitForWork(): Promise<void> {
    // Poll for work availability
    // In production, you might use a subscription if orgId is known
    await this.sleep(1000);
  }
  
  /**
   * Process available work
   */
  private async processWork(): Promise<void> {
    let work = await this.client.mutation<
      { apiKey: string },
      WorkItem | null
    >(this.api.workers.giveMeWork, { apiKey: this.apiKey });
    
    while (work && this.running) {
      const startTime = Date.now();
      console.log(`Processing job ${work.jobId}: ${work.type}`);
      this.onJobStart?.(work.jobId, work.type);
      
      // Start heartbeat
      const heartbeat = setInterval(() => {
        this.client
          .mutation(this.api.workers.imStillWorking, {
            apiKey: this.apiKey,
            jobId: work!.jobId,
          })
          .catch((err: Error) => {
            console.error("Heartbeat error:", err);
          });
      }, this.heartbeatInterval);
      
      this.currentJob = { id: work.jobId, heartbeat };
      
      try {
        // Find handler for this job type
        const handler = this.handlers[work.type];
        if (!handler) {
          throw new Error(`No handler for job type: ${work.type}`);
        }
        
        // Create context for handler
        const context: JobContext = {
          jobId: work.jobId,
          type: work.type,
          sendProgress: async (data: unknown) => {
            await this.client.mutation(this.api.workers.submitResult, {
              apiKey: this.apiKey,
              jobId: work!.jobId,
              result: data,
              state: "streaming" as ResultState,
            });
          },
        };
        
        // Execute handler
        const result = await handler(work.payload, context);
        
        // Submit success and get next job
        work = await this.client.mutation<
          { apiKey: string; jobId: string; result: unknown; state: ResultState },
          WorkItem | null
        >(this.api.workers.submitResult, {
          apiKey: this.apiKey,
          jobId: work.jobId,
          result,
          state: "success",
        });
        
        const duration = Date.now() - startTime;
        const completedJobId = this.currentJob.id;
        console.log(`Job ${completedJobId} completed in ${duration}ms`);
        this.onJobComplete?.(completedJobId, work?.type ?? "unknown", duration);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`Job ${work.jobId} failed:`, err);
        this.onError?.(err, work.jobId);
        
        // Submit failure
        await this.client.mutation(this.api.workers.submitResult, {
          apiKey: this.apiKey,
          jobId: work.jobId,
          error: err.message,
          state: "failed" as ResultState,
        });
        
        work = null;
      } finally {
        clearInterval(heartbeat);
        this.currentJob = null;
      }
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a simple worker with just handlers
 * This is a convenience function for simple use cases
 */
export async function createWorker(
  convexUrl: string,
  config: Omit<WorkerConfig, "convexUrl"> & { api: typeof Worker.prototype.api }
): Promise<Worker> {
  // Dynamic import to avoid bundling ConvexClient in browser builds
  const { ConvexClient } = await import("convex/browser");
  const client = new ConvexClient(convexUrl);
  
  return new Worker(client, {
    ...config,
    convexUrl,
  });
}
