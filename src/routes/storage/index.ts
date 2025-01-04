import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { StorageService } from "./services";
import { z } from "zod";
import { errorHandler } from "../../middleware/error";
import { authMiddleware } from "../../middleware/auth";

export const storageRouter = new Hono()
  .use("*", errorHandler())
  .use("*", authMiddleware());

const uploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.literal('text/csv')
});
storageRouter.post("/upload",
    async (c) => {
      try {
        // Check content type to determine if this is the initial request or file upload
        const contentType = c.req.header('Content-Type');
        
        if (contentType === 'application/json') {
          // Initial request with fileName
          const { fileName } = await c.req.json();
          return c.json({
            success: true,
            message: 'Ready for file upload'
          });
        }
        
        // File upload request
        const fileData = await c.req.text(); // Get as text since it's CSV
        const fileName = `email-list-${Date.now()}.csv`;
        const key = `${Date.now()}-${fileName}`;
        
        // Convert text to Blob for R2
        const blob = new Blob([fileData], { type: 'text/csv' });
        
        // Upload to R2
        const storage = new StorageService(c.env.STORAGE);
        const result = await storage.uploadFile(key, blob);
        
        // Get a signed URL for the uploaded file
        const url = await storage.getSignedUrl(key);
  
        // Log the upload
        await c.env.KV.put(`storage:upload:${key}`, JSON.stringify({
          timestamp: Date.now(),
          requestedBy: c.get("userId"),
          fileName,
          size: result.size,
          etag: result.etag
        }));
  
        return c.json({
          success: true,
          key,
          url,
          size: result.size,
          etag: result.etag
        });
      } catch (error) {
        console.error("File upload error:", error);
        return c.json({
          success: false,
          message: error.message
        }, 400);
      }
    }
  );

// List files endpoint
storageRouter.get("/files", async (c) => {
  try {
    const storage = new StorageService(c.env.STORAGE);
    const files = await storage.listFiles();
    
    return c.json({
      success: true,
      files: files.map(file => ({
        key: file.key,
        size: file.size,
        uploaded: file.uploaded,
        etag: file.etag
      }))
    });
  } catch (error) {
    console.error("List files error:", error);
    throw error;
  }
});

// Delete file endpoint
storageRouter.delete("/files/:key", async (c) => {
  try {
    const key = c.req.param('key');
    const storage = new StorageService(c.env.STORAGE);
    
    await storage.deleteFile(key);
    
    // Log the deletion
    await c.env.KV.put(`storage:delete:${key}`, JSON.stringify({
      timestamp: Date.now(),
      requestedBy: c.get("userId"),
      key
    }));

    return c.json({
      success: true,
      message: `File ${key} deleted successfully`
    });
  } catch (error) {
    console.error("File deletion error:", error);
    throw error;
  }
}); 