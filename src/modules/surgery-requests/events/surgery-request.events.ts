import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

export const SURGERY_REQUEST_EVENTS = {
  STATUS_CHANGED: 'surgery-request.status_changed',
  UPDATED: 'surgery-request.updated',
} as const;

export interface SurgeryRequestStatusChangedEvent {
  surgeryRequestId: string;
  from: SurgeryRequestStatus;
  to: SurgeryRequestStatus;
  actorId: string | null;
}

export interface SurgeryRequestUpdatedEvent {
  surgeryRequestId: string;
  actorId: string | null;
}

interface EventSink {
  emit(event: string, payload: unknown): unknown;
}

export function emitSurgeryRequestStatusChanged(
  emitter: EventSink,
  event: SurgeryRequestStatusChangedEvent,
): void {
  emitter.emit(SURGERY_REQUEST_EVENTS.STATUS_CHANGED, event);
}

export function emitSurgeryRequestUpdated(
  emitter: EventSink,
  event: SurgeryRequestUpdatedEvent,
): void {
  emitter.emit(SURGERY_REQUEST_EVENTS.UPDATED, event);
}
