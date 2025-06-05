import { z } from 'zod';

// User schema with validation
export const UserSchema = z.object({
  userId: z.string().uuid(),
  sk: z.literal('USER#metadata'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  location: z.string(), // IANA timezone (e.g., 'America/New_York')
  birthdayMD: z.string().regex(/^\d{2}-\d{2}$/), // MM-DD
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type User = z.infer<typeof UserSchema>;

// Message log schema
export const MessageLogSchema = z.object({
  messageId: z.string(), // userId_YYYY-MM-DD
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'CANCELLED']),
  attempts: z.number().int().min(0),
  lastAttempt: z.string().datetime().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ttl: z.number().optional() // Unix timestamp for DynamoDB TTL
});

export type MessageLog = z.infer<typeof MessageLogSchema>;

// API request/response types
export const CreateUserRequestSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string()
});

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const BirthdayMessageSchema = z.object({
  userId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  location: z.string()
});

export type BirthdayMessage = z.infer<typeof BirthdayMessageSchema>; 