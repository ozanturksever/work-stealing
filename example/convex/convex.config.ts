import { defineApp } from "convex/server";
import workStealing from "@fatagnus/work-stealing/convex.config";

const app = defineApp();
app.use(workStealing);

export default app;
