import { z } from "zod";

export const verifySetupSchema = z.object({
  domain: z.string()
    .regex(/^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+$/)
    .min(4)
    .max(253)
});

export const setupDomainSchema = z.object({
  domain: z.string()
    .regex(/^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+$/)
    .min(4)
    .max(253),
  redirectTo: z.string().url().max(253),
  email: z.object({
    reportAddress: z.string().email(),
    useOffice365: z.boolean(),
    customSpf: z.string().optional(),
  }),
  security: z.object({
    enableDMARC: z.boolean(),
    dmarcPolicy: z.enum(["none", "quarantine", "reject"]),
    enableHSTS: z.boolean(),
    enableCAA: z.boolean(),
  })
});