import { z } from 'zod';

export const DomainSchema = z.object({
  domain: z.string()
    .regex(/^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+$/)
    .min(4)
    .max(253),
  redirectTo: z.string()
    .url()
    .max(253),
  reportEmail: z.string()
    .email()
    .max(254)
});