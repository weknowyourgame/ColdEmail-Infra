import { Context } from "hono";

export const errorHandler = () => async (c: Context, next: Function) => {
    try {
      await next();
    } catch (error) {
      console.error("Error:", error);
      return c.json({
        error: (error as Error).message || "Internal server error",
        requestId: c.req.header("cf-ray"),
        // @ts-ignore
      }, (error as Error).status || 500);
    }
  };
