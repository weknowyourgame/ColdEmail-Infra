import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { WarmupService } from "./services";
import { authMiddleware } from "../../middleware/auth";

export const warmupRouter = new Hono();

const warmupSchema = z.object({
  apiKey: z.string(),
  totalWarmupPerDay: z.number().min(1).max(100).default(50),
  dailyRampup: z.number().min(1).max(100).default(50),
  replyRatePercentage: z.number().min(1).max(100).default(100),
  warmupKeyId: z.string().optional()
});

const reconnectSchema = z.object({
  apiKey: z.string()
});

warmupRouter.post(
  "/process",
  authMiddleware(),
  zValidator("json", warmupSchema),
  async (c) => {
    try {
      const config = await c.req.json();
      
      // Create request ID for tracking
      const requestId = c.req.header("cf-ray") || crypto.randomUUID();
      
      // Log warmup request
      await c.env.KV.put(`warmup:request:${requestId}`, JSON.stringify({
        timestamp: Date.now(),
        requestedBy: c.get("userId"),
        config
      }));

      // Process warmup
      const warmupService = new WarmupService(config);
      const result = await warmupService.processWarmup();

      // Log completion
      await c.env.KV.put(`warmup:complete:${requestId}`, JSON.stringify({
        timestamp: Date.now(),
        result
      }));

      return c.json({
        success: true,
        requestId,
        result
      });

    } catch (error) {
      console.error("Warmup error:", error);
      throw error;
    }
  }
);

warmupRouter.post(
  "/reconnect",
  authMiddleware(),
  zValidator("json", reconnectSchema),
  async (c) => {
    try {
      const { apiKey } = await c.req.json();
      const requestId = c.req.header("cf-ray") || crypto.randomUUID();
      
      const warmupService = new WarmupService({ apiKey });
      const result = await warmupService.reconnectFailedAccounts();

      return c.json({
        success: true,
        requestId,
        result
      });

    } catch (error) {
      console.error("Reconnect error:", error);
      throw error;
    }
  }
); 