import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { AutomationService } from "./services";
import { authMiddleware } from "../../middleware/auth";

export const automationRouter = new Hono();

const automationSchema = z.object({
  apiKey: z.string(),
  csvData: z.string(),
  loginUrl: z.string().url(),
  maxRetries: z.number().min(1).max(10).optional()
});

automationRouter.post(
  "/process",
  authMiddleware(),
  zValidator("json", automationSchema),
  async (c) => {
    try {
      const config = await c.req.json();
      
      // Create request ID for tracking
      const requestId = c.req.header("cf-ray") || crypto.randomUUID();
      
      // Log automation request
      await c.env.KV.put(`automation:request:${requestId}`, JSON.stringify({
        timestamp: Date.now(),
        requestedBy: c.get("userId"),
        config: {
          ...config,
          csvLength: config.csvData.split('\n').length - 1 // Exclude header
        }
      }));

      // Process automation
      const automationService = new AutomationService(config, c.env);
      const result = await automationService.processAutomation();

      // Log completion
      await c.env.KV.put(`automation:complete:${requestId}`, JSON.stringify({
        timestamp: Date.now(),
        result
      }));

      return c.json({
        success: true,
        requestId,
        result
      });

    } catch (error) {
      console.error("Automation error:", error);
      throw error;
    }
  }
); 