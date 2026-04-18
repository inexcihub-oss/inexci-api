const NodeEnvironment = require('jest-environment-node').TestEnvironment;

/**
 * Custom test environment para testes e2e.
 * Monkey-patches o handler de unhandled rejections do jest-circus
 * para ignorar rejeições undefined (causadas pelo Bull/ioredis).
 */
class E2eTestEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
  }

  async setup() {
    await super.setup();

    // Monkey-patch: interceptar a adição de listeners de unhandledRejection
    // para filtrar rejections undefined (do Bull)
    const originalOn = process.on.bind(process);
    process.on = function (event, listener) {
      if (event === 'unhandledRejection') {
        const wrappedListener = function (reason, promise) {
          // Ignorar rejeições undefined do Bull/Redis
          if (reason === undefined || reason === null) {
            return;
          }
          if (reason instanceof Error) {
            const msg = reason.message || '';
            if (
              msg.includes("Stream isn't writeable") ||
              msg.includes('enableOfflineQueue') ||
              msg.includes('Connection is closed')
            ) {
              return;
            }
          }
          return listener.call(this, reason, promise);
        };
        return originalOn(event, wrappedListener);
      }
      return originalOn(event, listener);
    };
  }

  async teardown() {
    await super.teardown();
  }
}

module.exports = E2eTestEnvironment;
