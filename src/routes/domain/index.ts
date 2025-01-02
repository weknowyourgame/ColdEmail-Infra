import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CloudflareService } from "./services";
import { setupDomainSchema, verifySetupSchema } from "./schemas";
import { errorHandler } from "../../middleware/error";
import { authMiddleware } from "../../middleware/auth";

export const domainRouter = new Hono()
  .use("*", errorHandler())
  .use("*", authMiddleware())

domainRouter.get("/verify", 
  zValidator("query", verifySetupSchema),
  async (c) => {
    try {
      const { domain } = c.req.query();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);
      
      const validation = await cf.verifyDomain(domain);
      // @ts-ignore
      return c.json(validation);
    } catch (error) {
      console.error("Verification error:", error);
      throw error;
    }
});

domainRouter.post("/setup",
  zValidator("json", setupDomainSchema),
  async (c) => {
    try {
      const body = await c.req.json();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);
      
      // Audit log entry
      const requestId = c.req.header("cf-ray") || crypto.randomUUID();
      await c.env.KV.put(`setup:${requestId}`, JSON.stringify({
        timestamp: Date.now(),
        domain: body.domain,
        requestedBy: c.get("userId"),
      }));

      const setup = await cf.setupDomainAndEmail(body);
      
      // Log successful setup
      await c.env.KV.put(`domain:${body.domain}:setup`, JSON.stringify({
        ...setup,
        requestId,
        completedAt: Date.now()
      }));

      return c.json(setup);
    } catch (error) {
      console.error("Setup error:", error);
      throw error;
    }
});