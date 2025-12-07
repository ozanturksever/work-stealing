/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";

// Note: This glob pattern requires Vite's import.meta.glob
// If not using Vite, you'll need to manually list the modules
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the work-stealing component with a test convex instance.
 * 
 * @param t - The test convex instance, e.g. from calling `convexTest`
 * @param name - The name of the component, as registered in convex.config.ts
 * 
 * @example
 * ```ts
 * import { convexTest } from "convex-test";
 * import workStealingTest from "@fatagnus/work-stealing/test";
 * import schema from "./schema";
 * 
 * const t = convexTest(schema, modules);
 * workStealingTest.register(t, "workStealing");
 * 
 * test("submit job", async () => {
 *   // ... test code
 * });
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "workStealing"
): void {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
