import { ToolContext } from '../tool.interface';
import { OperationDraftService } from '../../services/operation-draft.service';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { SurgeryRequestPriority } from '../../../../database/entities/surgery-request.entity';

export function enumKeyToPriority(
  key: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
): SurgeryRequestPriority {
  switch (key) {
    case 'LOW':
      return SurgeryRequestPriority.LOW;
    case 'MEDIUM':
      return SurgeryRequestPriority.MEDIUM;
    case 'HIGH':
      return SurgeryRequestPriority.HIGH;
    case 'URGENT':
      return SurgeryRequestPriority.URGENT;
  }
}

export async function autoFillDoctorIfSingle(
  draftService: OperationDraftService,
  userRepo: UserRepository,
  context: ToolContext,
): Promise<void> {
  const accessible = context.accessibleDoctorIds || [];
  if (accessible.length === 0) return;
  const current = await draftService.getCurrentOfType(
    context.conversationId,
    'create_sc',
  );
  if (!current || current.fields.doctorId) return;

  let pick: string | null = null;
  if (accessible.length === 1) {
    pick = accessible[0];
  } else if (context.userId && accessible.includes(context.userId)) {
    pick = context.userId;
  } else {
    return;
  }

  const doctor = await userRepo.findOne({ id: pick } as any);
  await draftService.setFields(context.conversationId, 'create_sc', {
    doctorId: pick,
    doctorLabel: doctor?.name ?? undefined,
  });
}
