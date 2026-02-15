import { z } from "zod";

export const setupRequest = z.object({
  hostname: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(1194),
  protocol: z.enum(["udp", "tcp"]).default("udp"),
  devType: z.enum(["tun", "tap"]).default("tun"),
  subnet: z.string().default("10.8.0.0"),
  subnetMask: z.string().default("255.255.255.0"),
  dns: z.array(z.string()).default(["1.1.1.1", "1.0.0.1"]),
  cipher: z.string().default("AES-256-GCM"),
});

export type SetupRequest = z.infer<typeof setupRequest>;
