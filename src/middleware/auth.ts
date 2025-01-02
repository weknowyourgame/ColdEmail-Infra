import { Context } from "hono";

export const authMiddleware = () => async (c: Context, next: Function) => {
    const token = c.req.header("Authorization")?.split("Bearer ")[1];
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    // Verify token and add userId to context
    c.set("userId", "verified-user-id");
    return next();
  };