import { config } from 'dotenv';
import { resolve } from 'path';
import { comBancoDeTeste } from '../src/shared/testing/e2e-database-guard';

// Carrega as variáveis de ambiente ANTES de qualquer módulo ser avaliado
config({ path: resolve(__dirname, '../.env') });

// Definir NODE_ENV=test para desabilitar rate limiting
process.env.NODE_ENV = 'test';

// Suprimir erros de teardown do Bull/Redis durante fechamento do app
// Estes erros ocorrem quando workers do Bull tentam se desconectar
process.on('unhandledRejection', (reason) => {
  // Ignorar erros de stream do Redis durante shutdown e rejeições com undefined
  if (reason === undefined) return;
  if (
    reason instanceof Error &&
    (reason.message?.includes("Stream isn't writeable") ||
      reason.message?.includes('enableOfflineQueue'))
  ) {
    return;
  }
});

// Valores padrão para testes
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-e2e-tests-123456789';
}
// O banco é sempre o de teste, nunca o do `.env`: `cleanDatabase` trunca todas
// as tabelas a cada teste. Este arquivo é `setupFiles` do Jest — roda antes de
// qualquer módulo da aplicação ser avaliado, que é o único momento em que dá
// para trocar a connection string com segurança.
process.env.DATABASE_URL = comBancoDeTeste(
  process.env.DATABASE_URL ??
    'postgresql://inexci:inexci123@localhost:5432/inexci',
);
if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
}
if (!process.env.SUPABASE_PUBLISHABLE_KEY) {
  process.env.SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_placeholder_for_local_tests';
}
if (!process.env.SUPABASE_SECRET_KEY) {
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_placeholder_for_local_tests';
}
if (!process.env.SUPABASE_BUCKET) {
  process.env.SUPABASE_BUCKET = 'documents';
}
if (!process.env.DASHBOARD_URL) {
  process.env.DASHBOARD_URL = 'http://localhost:3001';
}
if (!process.env.PHONE_HASH_SALT) {
  process.env.PHONE_HASH_SALT = 'test-salt-e2e-inexci-xxxxxxxxxxxxxxxx!!';
}
if (!process.env.MAIL_USER) {
  process.env.MAIL_USER = 'test@test.com';
}
if (!process.env.MAIL_PASS) {
  process.env.MAIL_PASS = 'test-password';
}
