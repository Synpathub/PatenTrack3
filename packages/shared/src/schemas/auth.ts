import { z } from 'zod';

// --- Login ---
export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().length(6).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// --- Register ---
export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters') // S-14
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain a digit')
    .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
  name: z.string().min(1).max(255),
  organizationName: z.string().min(1).max(255).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// --- Verify Email ---
export const verifyEmailRequestSchema = z.object({
  code: z.string().length(8), // S-24: 8-char alphanumeric
});

// --- Forgot Password ---
export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});

// --- Reset Password ---
export const resetPasswordRequestSchema = z.object({
  code: z.string().length(8),
  newPassword: registerRequestSchema.shape.password,
});

// --- User Response ---
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  organizationId: z.string().uuid(),
  role: z.enum(['member', 'admin', 'super_admin']),
  mfaEnabled: z.boolean(),
  avatarUrl: z.string().nullable(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;
