import { config } from 'dotenv';
import { resolve } from 'path';

// Carrega as variáveis de ambiente ANTES de qualquer módulo ser avaliado
config({ path: resolve(__dirname, '../.env') });

// Valores padrão para testes
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-e2e-tests-123456789';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://inexci:inexci123@localhost:5432/inexci';
}
if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
}
if (!process.env.SUPABASE_KEY) {
  process.env.SUPABASE_KEY = 'placeholder-key-for-local-tests';
}
if (!process.env.SUPABASE_BUCKET_NAME) {
  process.env.SUPABASE_BUCKET_NAME = 'documents';
}
