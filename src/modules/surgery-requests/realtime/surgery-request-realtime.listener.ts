import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  SURGERY_REQUEST_EVENTS,
  type SurgeryRequestStatusChangedEvent,
  type SurgeryRequestUpdatedEvent,
} from '../events/surgery-request.events';
import { SurgeryRequestRealtimeService } from './surgery-request-realtime.service';

@Injectable()
export class SurgeryRequestRealtimeListener {
  constructor(
    private readonly realtimeService: SurgeryRequestRealtimeService,
  ) {}

  @OnEvent(SURGERY_REQUEST_EVENTS.STATUS_CHANGED)
  handleStatusChanged(event: SurgeryRequestStatusChangedEvent): Promise<void> {
    return this.realtimeService.broadcastChange(
      event.surgeryRequestId,
      'status-updated',
      event.actorId ?? undefined,
    );
  }

  @OnEvent(SURGERY_REQUEST_EVENTS.UPDATED)
  handleUpdated(event: SurgeryRequestUpdatedEvent): Promise<void> {
    return this.realtimeService.broadcastChange(
      event.surgeryRequestId,
      'updated',
      event.actorId ?? undefined,
    );
  }
}
