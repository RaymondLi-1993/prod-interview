import { z } from "zod";

export const PROVIDERS = ["supabase", "google", "github"] as const;

export const ProvidersLabel = z.enum(PROVIDERS);

export const userSchema = z
  .object({
    id: z.string().uuid(),
    auth_provider: ProvidersLabel,
    auth_provider_id: z.string(),
    email: z.string(),
    display_name: z.string().nullable(),
    created_at: z.date(),
    updated_at: z.date(),
    deleted_at: z.date().nullable(),
  })
  .transform((user) => ({
    id: user.id,
    authProvider: user.auth_provider,
    authProviderId: user.auth_provider_id,
    email: user.email,
    displayName: user.display_name,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    deletedAt: user.deleted_at,
  }));

export type User = z.output<typeof userSchema>;
export type Providers = z.output<typeof ProvidersLabel>;
