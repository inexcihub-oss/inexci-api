import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SUPABASE_CLIENT,
  SUPABASE_ADMIN_CLIENT,
  createSupabaseClient,
  createSupabaseAdminClient,
} from './supabase.config';

/**
 * Módulo global que fornece os clientes Supabase via injeção de dependência.
 * Elimina o uso direto de `process.env` nos services de storage/upload.
 */
@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_CLIENT,
      useFactory: (config: ConfigService) => createSupabaseClient(config),
      inject: [ConfigService],
    },
    {
      provide: SUPABASE_ADMIN_CLIENT,
      useFactory: (config: ConfigService) => createSupabaseAdminClient(config),
      inject: [ConfigService],
    },
  ],
  exports: [SUPABASE_CLIENT, SUPABASE_ADMIN_CLIENT],
})
export class SupabaseModule {}
