import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CloudflareService } from "./services";
import { setupDomainSchema, verifySetupSchema, createDomainSchema } from "./schemas";
import { errorHandler } from "../../middleware/error";
import { authMiddleware } from "../../middleware/auth";

export const domainRouter = new Hono()
  .use("*", errorHandler())
  .use("*", authMiddleware());

// Enable CORS for all endpoints
domainRouter.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") return c.json(null); // Preflight response for CORS
  await next();
});

// Verify domain
domainRouter.get(
  "/verify",
  zValidator("query", verifySetupSchema),
  async (c) => {
    try {
      const { domain } = c.req.query();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);

      const validation = await cf.verifyDomain(domain);
      return c.json(validation);
    } catch (error) {
      console.error("Verification error:", error);
      throw error;
    }
  }
);

// Setup domain and email
domainRouter.post(
  "/setup",
  zValidator("json", setupDomainSchema),
  async (c) => {
    try {
      const { domain, zoneId, redirectTo, email, security } = await c.req.json();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);

      // Audit log entry
      const requestId = c.req.header("cf-ray") || crypto.randomUUID();
      await c.env.KV.put(
        `setup:${requestId}`,
        JSON.stringify({
          timestamp: Date.now(),
          domain,
          zoneId,
          requestedBy: c.get("userId"),
        })
      );

      const setup = await cf.setupDomainAndEmail({
        domain,
        zoneId,
        redirectTo,
        reportEmail: email.reportAddress,
        ...email,
        ...security,
      });

      // Log successful setup
      await c.env.KV.put(
        `domain:${domain}:setup`,
        JSON.stringify({
          ...setup,
          requestId,
          completedAt: Date.now(),
        })
      );

      return c.json({
        success: true,
        setup,
        requestId,
      });
    } catch (error) {
      console.error("Setup error:", error);
      throw error;
    }
  }
);

// Create a new Cloudflare zone
domainRouter.post(
  "/createzone",
  zValidator("json", createDomainSchema),
  async (c) => {
    try {
      const { domain } = await c.req.json();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);

      // Audit log entry
      const requestId = c.req.header("cf-ray") || crypto.randomUUID();
      await c.env.KV.put(
        `create:${requestId}`,
        JSON.stringify({
          timestamp: Date.now(),
          domain,
          requestedBy: c.get("userId"),
        })
      );

      const { nameServers, zoneId } = await cf.createDomain(domain);

      // Log successful creation
      await c.env.KV.put(
        `domain:${domain}:create`,
        JSON.stringify({
          nameServers,
          zoneId,
          requestId,
          completedAt: Date.now(),
        })
      );

      return c.json({
        success: true,
        nameServers,
        zoneId,
        requestId,
      });
    } catch (error) {
      console.error("Domain creation error:", error);
      throw error;
    }
  }
);
