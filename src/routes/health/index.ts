import { Hono } from "hono";
import { CloudflareService } from "../domain/services";
import { StorageService } from "../storage/services";

export const healthRouter = new Hono();

healthRouter.get("/", async (c) => {
  const checks = {
    timestamp: new Date().toISOString(),
    status: "ok",
    services: {
      cloudflare: { status: "unknown" },
      storage: { status: "unknown" },
      kv: { status: "unknown" }
    }
  };

  try {
    // Check Cloudflare API
    const cf = new CloudflareService(c.env.CF_API_TOKEN);
    await cf.makeRequest("GET", "/user/tokens/verify");
    checks.services.cloudflare = { status: "healthy" };
  } catch (error) {
    checks.services.cloudflare = { 
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error"
    };
    checks.status = "degraded";
  }

  try {
    // Check R2 Storage
    const storage = new StorageService(c.env.STORAGE);
    await storage.listFiles();
    checks.services.storage = { status: "healthy" };
  } catch (error) {
    checks.services.storage = { 
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error"
    };
    checks.status = "degraded";
  }

  try {
    // Check KV
    const testKey = "health-check-test";
    await c.env.KV.put(testKey, "test");
    await c.env.KV.delete(testKey);
    checks.services.kv = { status: "healthy" };
  } catch (error) {
    checks.services.kv = { 
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error"
    };
    checks.status = "degraded";
  }

  // If any service is unhealthy, return 503
  const statusCode = checks.status === "ok" ? 200 : 503;
  return c.json(checks, statusCode);
}); 