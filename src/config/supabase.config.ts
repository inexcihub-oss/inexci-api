import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

/**
 * Factory para criar o cliente Supabase público (publishable key).
 * Equivalente à antiga `anon key` no novo esquema de chaves do Supabase.
 * Utilizado via injeção de dependência (SUPABASE_CLIENT).
 */
export function createSupabaseClient(config: ConfigService): SupabaseClient {
  const url = config.get<string>('SUPABASE_URL', '');
  const publishableKey = config.get<string>('SUPABASE_PUBLISHABLE_KEY', '');
  return createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
}

/**
 * Factory para criar o cliente Supabase com secret key.
 * Equivalente à antiga `service_role key` no novo esquema de chaves do Supabase.
 * Bypassa RLS — usado apenas no backend para storage.
 * Utilizado via injeção de dependência (SUPABASE_ADMIN_CLIENT).
 */
export function createSupabaseAdminClient(
  config: ConfigService,
): SupabaseClient {
  const url = config.get<string>('SUPABASE_URL', '');
  const publishableKey = config.get<string>('SUPABASE_PUBLISHABLE_KEY', '');
  const secretKey =
    config.get<string>('SUPABASE_SECRET_KEY', '') || publishableKey;
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Token de injeção para o cliente Supabase público */
export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

/** Token de injeção para o cliente Supabase admin (service_role) */
export const SUPABASE_ADMIN_CLIENT = 'SUPABASE_ADMIN_CLIENT';
