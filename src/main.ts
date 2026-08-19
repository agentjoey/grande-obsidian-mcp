import { serve } from "@hono/node-server";
import { createRuntime, loadRuntimeSettings } from "./runtime.ts";

const settings = loadRuntimeSettings(process.env);
const runtime = await createRuntime(settings);

serve({
  fetch: runtime.app.fetch,
  hostname: settings.host,
  port: settings.port,
});
