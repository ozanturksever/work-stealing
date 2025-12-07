import { WorkStealingClient } from "@convex-dev/work-stealing/client";
import { components } from "./_generated/api";

export const workStealing = new WorkStealingClient(components.workStealing);
