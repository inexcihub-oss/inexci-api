const originalListeners = process.listeners('unhandledRejection');

process.removeAllListeners('unhandledRejection');

process.on('unhandledRejection', (reason: unknown) => {
  if (reason === undefined || reason === null) return;

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

  for (const listener of originalListeners) {
    (listener as (reason: unknown) => void)(reason);
  }
});
