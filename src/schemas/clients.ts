import { z } from "zod";

export const createClient = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "Name must be alphanumeric with dashes/underscores"),
  email: z.string().email().optional(),
  staticIp: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, "Must be a valid IPv4 address").optional(),
  notes: z.string().max(500).optional(),
});

export const updateClientConfig = z.object({
  staticIp: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, "Must be a valid IPv4 address").optional(),
  pushRoutes: z.array(z.string()).optional(),
});

export const clientListQuery = z.object({
  status: z.enum(["active", "revoked", "expired"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export type CreateClient = z.infer<typeof createClient>;
export type UpdateClientConfig = z.infer<typeof updateClientConfig>;
export type ClientListQuery = z.infer<typeof clientListQuery>;
