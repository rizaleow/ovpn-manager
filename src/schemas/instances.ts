import { z } from "zod";

export const createInstance = z.object({
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/, "Name must be alphanumeric with dashes, no leading/trailing hyphens"),
  displayName: z.string().max(64).optional(),
});

export type CreateInstance = z.infer<typeof createInstance>;
