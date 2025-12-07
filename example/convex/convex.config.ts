import { defineApp } from "convex/server";
import workStealing from "@convex-dev/work-stealing/convex.config";

const app = defineApp();
app.use(workStealing);

export default app;
