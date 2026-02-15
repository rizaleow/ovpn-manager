import { z } from "zod";

export const updateServerConfig = z.object({
  hostname: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(["udp", "tcp"]).optional(),
  devType: z.enum(["tun", "tap"]).optional(),
  subnet: z.string().optional(),
  subnetMask: z.string().optional(),
  dns: z.array(z.string()).optional(),
  cipher: z.string().optional(),
  auth: z.string().optional(),
  tlsAuth: z.boolean().optional(),
  compress: z.string().optional(),
  clientToClient: z.boolean().optional(),
  maxClients: z.number().int().min(1).optional(),
  keepalive: z.string().optional(),
});

export type UpdateServerConfig = z.infer<typeof updateServerConfig>;
