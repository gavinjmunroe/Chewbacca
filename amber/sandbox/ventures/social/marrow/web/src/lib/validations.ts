import { z } from 'zod'

export const profileSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(50),
  last_name: z.string().min(1, 'Last name is required').max(50),
  headline: z.string().max(150).optional(),
  school: z.string().max(100).optional(),
  graduation_year: z.number().int().min(2020).max(2035).optional().nullable(),
  major: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
  linkedin_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  github_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  website_url: z.string().url('Invalid URL').optional().or(z.literal('')),
})

export const organizationSchema = z.object({
  name: z.string().min(2, 'Organization name is required').max(100),
  slug: z
    .string()
    .min(2, 'Slug is required')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  description: z.string().min(20, 'Please provide at least 20 characters').max(1000).optional(),
  school: z.string().max(100).optional(),
  category: z.string().optional(),
  website: z.string().url('Invalid URL').optional().or(z.literal('')),
})

export const cycleSchema = z.object({
  name: z.string().min(3, 'Cycle name is required').max(100),
  description: z.string().max(2000).optional(),
  application_open_at: z.string().datetime().optional().nullable(),
  application_close_at: z.string().datetime().optional().nullable(),
  max_applicants: z.number().int().positive().optional().nullable(),
  target_class_size: z.number().int().positive().optional().nullable(),
  is_public: z.boolean().default(true),
})

export const stageSchema = z.object({
  name: z.string().min(1, 'Stage name is required').max(100),
  description: z.string().max(500).optional(),
  stage_order: z.number().int().nonnegative(),
  stage_type: z.enum(['application', 'event', 'interview', 'decision']).default('application'),
  is_blind: z.boolean().default(false),
  is_required: z.boolean().default(true),
})

export const questionSchema = z.object({
  question_text: z.string().min(5, 'Question text is required').max(1000),
  question_type: z.enum([
    'short_text', 'long_text', 'single_choice',
    'multi_choice', 'file_upload', 'url', 'number',
  ]),
  is_required: z.boolean().default(true),
  options: z.array(z.string()).optional().nullable(),
  word_limit: z.number().int().positive().max(5000).optional().nullable(),
  char_limit: z.number().int().positive().max(25000).optional().nullable(),
  placeholder: z.string().max(200).optional(),
  helper_text: z.string().max(500).optional(),
  question_order: z.number().int().nonnegative(),
})

export const rubricCriterionSchema = z.object({
  criterion_name: z.string().min(1, 'Criterion name is required').max(100),
  description: z.string().max(500).optional(),
  max_score: z.number().int().min(1).max(100).default(5),
  weight: z.number().positive().max(10).default(1.0),
  criterion_order: z.number().int().nonnegative(),
})

export const reviewSchema = z.object({
  notes: z.string().max(5000).optional(),
  recommendation: z.enum(['advance', 'reject', 'hold', 'undecided']).optional(),
  scores: z.record(z.string(), z.number().int().nonnegative()),
})

export const messageSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(200),
  body: z.string().min(1, 'Message body is required').max(10000),
  recipient_type: z.enum(['all', 'stage', 'status', 'individual']),
  recipient_filter: z.record(z.string(), z.unknown()).optional().default({}),
})

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  first_name: z.string().min(1, 'First name is required').max(50),
  last_name: z.string().min(1, 'Last name is required').max(50),
})

export type ProfileInput = z.infer<typeof profileSchema>
export type OrganizationInput = z.infer<typeof organizationSchema>
export type CycleInput = z.infer<typeof cycleSchema>
export type StageInput = z.infer<typeof stageSchema>
export type QuestionInput = z.infer<typeof questionSchema>
export type RubricCriterionInput = z.infer<typeof rubricCriterionSchema>
export type ReviewInput = z.infer<typeof reviewSchema>
export type MessageInput = z.infer<typeof messageSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
