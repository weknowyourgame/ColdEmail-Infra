import { Context } from "hono";
import { verify } from "@tsndr/cloudflare-worker-jwt";

export const authMiddleware = () => async (c: Context, next: Function) => {
    const token = c.req.header("Authorization")?.split("Bearer ")[1];
    if (!token) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    try {
        // Verify the token using the same secret as your frontend
        const isValid = await verify(token, c.env.JWT_SECRET);
        
        if (!isValid) {
            throw new Error("Invalid token");
        }

        // If you need user info in your routes
        const payload = JSON.parse(atob(token.split('.')[1]));
        c.set("userId", payload.sub || payload.id);
        
        return next();
    } catch (error) {
        console.error("Token verification error:", error);
        return c.json({ error: "Invalid token" }, 401);
    }
};
