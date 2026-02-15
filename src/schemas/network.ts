import { z } from "zod";

export const addIptablesRule = z.object({
  chain: z.enum(["POSTROUTING", "FORWARD"]).default("POSTROUTING"),
  source: z.string(),
  destination: z.string().optional(),
  outInterface: z.string().optional(),
  target: z.enum(["MASQUERADE", "ACCEPT", "DROP"]).default("MASQUERADE"),
});

export const updateForwarding = z.object({
  enabled: z.boolean(),
});

export const updateRoutes = z.object({
  routes: z.array(
    z.object({
      network: z.string(),
      netmask: z.string(),
    }),
  ),
});

export type AddIptablesRule = z.infer<typeof addIptablesRule>;
export type UpdateRoutes = z.infer<typeof updateRoutes>;
