import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CloudflareService } from "./services";
import { setupDomainSchema, verifySetupSchema, createDomainSchema } from "./schemas";
import { errorHandler } from "../../middleware/error";
import { authMiddleware } from "../../middleware/auth";
import { z } from "zod";

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

// Get nameservers and verify domain setup status
domainRouter.get(
  "/verify-setup/:domain",
  zValidator("param", z.object({ domain: z.string() })),
  async (c) => {
    try {
      const { domain } = c.req.param();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);

      const verificationResult = await cf.verifyDomainSetup(domain);
      
      // Get stored setup info from KV if available
      const setupInfo = await c.env.KV?.get(`domain:${domain}:setup`);
      const parsedSetupInfo = setupInfo ? JSON.parse(setupInfo) : null;

      return c.json({
        ...verificationResult,
        setupInfo: parsedSetupInfo,
      });
    } catch (error) {
      console.error("Verification error:", error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : "Verification failed"
      }, 500);
    }
  }
);

// Update redirect URLs for existing domain
domainRouter.patch(
  "/redirect",
  zValidator("json", z.object({
    domain: z.string(),
    redirectTo: z.string().url(),
    zoneId: z.string()
  })),
  async (c) => {
    try {
      const { domain, redirectTo, zoneId } = await c.req.json();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);

      const result = await cf.updateRedirect(zoneId, domain, redirectTo);
      
      // Log the redirect update if KV is available
      const requestId = c.req.header("cf-ray") || crypto.randomUUID();
      if (c.env.KV) {
        await c.env.KV.put(
          `domain:${domain}:redirect`,
          JSON.stringify({
            timestamp: Date.now(),
            redirectTo,
            requestId,
            pageRuleId: result.result?.id
          })
        );
      }

      return c.json({
        success: true,
        domain,
        redirectTo,
        pageRuleId: result.result?.id,
        requestId
      });
    } catch (error) {
      console.error("Redirect update error:", error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update redirect"
      }, 500);
    }
  }
);

// Get all redirects for a zone
domainRouter.get(
  "/redirects/:zoneId",
  zValidator("param", z.object({ zoneId: z.string() })),
  async (c) => {
    try {
      const { zoneId } = c.req.param();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);

      const result = await cf.getRedirects(zoneId);
      
      // Log the request if KV is available
      if (c.env.KV) {
        await c.env.KV.put(
          `zone:${zoneId}:redirects:list`,
          JSON.stringify({
            timestamp: Date.now(),
            requestedBy: c.get("userId"),
            count: result.redirects.length
          })
        );
      }

      return c.json(result);
    } catch (error) {
      console.error("Get redirects error:", error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get redirects"
      }, 500);
    }
  }
);

// Delete a redirect rule
domainRouter.delete(
  "/redirect/:zoneId/:ruleId",
  zValidator("param", z.object({ 
    zoneId: z.string(),
    ruleId: z.string()
  })),
  async (c) => {
    try {
      const { zoneId, ruleId } = c.req.param();
      const cf = new CloudflareService(c.env.CF_API_TOKEN);

      const result = await cf.deleteRedirect(zoneId, ruleId);
      
      // Log the deletion if KV is available
      if (c.env.KV) {
        await c.env.KV.put(
          `zone:${zoneId}:redirect:${ruleId}:delete`,
          JSON.stringify({
            timestamp: Date.now(),
            requestedBy: c.get("userId"),
            success: true
          })
        );
      }

      return c.json(result);
    } catch (error) {
      console.error("Delete redirect error:", error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete redirect"
      }, 500);
    }
  }
);
