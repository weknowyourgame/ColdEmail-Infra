import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './middleware/auth';
import { CloudflareService } from './routes/domain/services';
import { domainRouter } from './routes/domain';
import { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));

app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', secureHeaders());

app.route('/api/domain', domainRouter);

app.use('*', async (c, next) => {
  try {
    await next();
  } catch (error) {
    console.error('Error:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Internal server error',
      requestId: c.req.header('cf-ray') || 'dev'
    }, 500);
  }
});

app.post('/api/setup-domain', authMiddleware(), async (c) => {
  try {
    const body = await c.req.json();
    
    if (!c.env?.CF_API_TOKEN) {
      throw new Error('Cloudflare API token not configured');
    }

    const cloudflare = new CloudflareService(c.env.CF_API_TOKEN);
    const result = await cloudflare.setupDomainAndEmail(body);
    
    if (c.env.KV) {
      await c.env.KV.put(`domain:${body.domain}:setup`, JSON.stringify({
        timestamp: Date.now(),
        result,
        requestId: c.req.header('cf-ray') || 'dev'
      }));
    }

    return c.json(result);
  } catch (error) {
    if (error instanceof Error) {
      return c.json({ 
        error: error.message,
        requestId: c.req.header('cf-ray') || 'dev'
      }, 500);
    }
    throw error;
  }
});

export default app;
