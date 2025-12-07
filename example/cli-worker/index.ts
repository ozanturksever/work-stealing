import { ConvexClient } from "convex/browser";
import { Worker } from "@convex-dev/work-stealing/client/worker";
import { components } from "../convex/_generated/api";
import dotenv from "dotenv";

dotenv.config();

const CONVEX_URL = process.env.CONVEX_URL;
const WORKER_API_KEY = process.env.WORKER_API_KEY;

if (!CONVEX_URL || !WORKER_API_KEY) {
  console.error("Missing CONVEX_URL or WORKER_API_KEY environment variables");
  process.exit(1);
}

async function main() {
  const client = new ConvexClient(CONVEX_URL);
  
  const worker = new Worker(client, {
    apiKey: WORKER_API_KEY,
    convexUrl: CONVEX_URL,
    api: components.workStealing,
    handlers: {
      "process-file": async (payload, ctx) => {
        const { fileId, fileName } = payload as { fileId: string; fileName: string };
        
        console.log(`Processing file: ${fileName} (${fileId})`);
        
        // Send progress updates
        await ctx.sendProgress({ status: "starting", progress: 0 });
        
        // Simulate processing steps
        for (let i = 1; i <= 5; i++) {
          await sleep(1000);
          await ctx.sendProgress({ status: "processing", progress: i * 20 });
          console.log(`Progress: ${i * 20}%`);
        }
        
        console.log(`Completed processing: ${fileName}`);
        
        return {
          success: true,
          processedAt: new Date().toISOString(),
          fileId,
        };
      },
      
      "analyze-data": async (payload, ctx) => {
        const { data } = payload as { data: unknown };
        
        await ctx.sendProgress({ status: "analyzing" });
        
        // Simulate analysis
        await sleep(2000);
        
        return {
          analyzed: true,
          insights: ["Insight 1", "Insight 2"],
        };
      },
    },
    onJobStart: (jobId, type) => {
      console.log(`[START] Job ${jobId} (${type})`);
    },
    onJobComplete: (jobId, type, duration) => {
      console.log(`[COMPLETE] Job ${jobId} (${type}) in ${duration}ms`);
    },
    onError: (error, jobId) => {
      console.error(`[ERROR] ${jobId ? `Job ${jobId}: ` : ""}${error.message}`);
    },
  });
  
  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down...");
    await worker.stop();
    process.exit(0);
  });
  
  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down...");
    await worker.stop();
    process.exit(0);
  });
  
  console.log("Starting worker...");
  await worker.start();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Worker failed:", error);
  process.exit(1);
});
