import { z } from 'zod';

// --- Pagination ---
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export const paginatedResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: z.array(dataSchema),
    cursor: z
      .object({
        next: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .optional(),
    total: z.number().int().optional(),
  });

// --- API Error ---
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// --- API Success ---
export const apiSuccessSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema,
  });
