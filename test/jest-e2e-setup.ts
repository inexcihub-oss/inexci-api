/**
 * Setup Jest global para suprimir erros de teardown do Bull/Redis.
 *
 * O Bull cria workers que emitem rejeições durante o shutdown do NestJS
 * (ex: "Stream isn't writeable and enableOfflineQueue options is false").
 * O jest-circus captura essas rejeições como "thrown: undefined" e reporta
 * como falhas de suíte, mesmo quando todos os testes passaram.
 *
 * Este arquivo é executado pelo jest como globalSetup e suprime esses erros.
 */

// Capturar rejeições não tratadas e ignorar as do Bull/Redis
const originalListeners = process.listeners('unhandledRejection');

// Remover listeners existentes
process.removeAllListeners('unhandledRejection');

// Adicionar nosso handler que filtra erros do Bull/Redis
process.on('unhandledRejection', (reason: unknown) => {
  // Suprimir rejeições undefined (típicas do Bull durante shutdown)
  if (reason === undefined || reason === null) return;

  // Suprimir erros de stream do Redis
  if (reason instanceof Error) {
    const msg = reason.message || '';
    if (
      msg.includes("Stream isn't writeable") ||
      msg.includes('enableOfflineQueue') ||
      msg.includes('Connection is closed') ||
      msg.includes('Redis connection')
    ) {
      return;
    }
  }

  // Re-emitir para os listeners originais se não for erro de Redis/Bull
  for (const listener of originalListeners) {
    (listener as (reason: unknown) => void)(reason);
  }
});
