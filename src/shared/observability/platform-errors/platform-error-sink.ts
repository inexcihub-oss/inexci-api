import type { PlatformErrorSource } from 'src/database/entities/platform-error-daily.entity';

export interface PlatformErrorEvent {
  source: PlatformErrorSource;
  route: string | null;
  error: unknown;
  ownerId?: string | null;
  userId?: string | null;
  requestId?: string | null;
}

type PlatformErrorSink = (event: PlatformErrorEvent) => void;

let sink: PlatformErrorSink | null = null;

export function registerPlatformErrorSink(
  next: PlatformErrorSink | null,
): void {
  sink = next;
}

export function reportPlatformError(event: PlatformErrorEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {}
}
