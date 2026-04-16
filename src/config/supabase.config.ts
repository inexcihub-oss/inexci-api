import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

/**
 * Factory para criar o cliente Supabase público.
 * Utilizado via injeção de dependência (SUPABASE_CLIENT).
 */
export function createSupabaseClient(config: ConfigService): SupabaseClient {
  const url = config.get<string>('SUPABASE_URL', '');
  const key = config.get<string>('SUPABASE_KEY', '');
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

/**
 * Factory para criar o cliente Supabase com service_role.
 * Bypassa RLS — usado apenas no backend para storage.
 * Utilizado via injeção de dependência (SUPABASE_ADMIN_CLIENT).
 */
export function createSupabaseAdminClient(
  config: ConfigService,
): SupabaseClient {
  const url = config.get<string>('SUPABASE_URL', '');
  const key = config.get<string>('SUPABASE_KEY', '');
  const serviceKey = config.get<string>('SUPABASE_SERVICE_KEY', '') || key;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Token de injeção para o cliente Supabase público */
export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

/** Token de injeção para o cliente Supabase admin (service_role) */
export const SUPABASE_ADMIN_CLIENT = 'SUPABASE_ADMIN_CLIENT';
