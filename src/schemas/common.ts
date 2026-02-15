import { z } from "zod";

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const linesQuery = z.object({
  lines: z.coerce.number().int().min(1).max(10000).default(100),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;
