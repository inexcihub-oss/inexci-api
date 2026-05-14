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

/**
 * Quando o usuário tem acesso a apenas 1 médico, o `doctorId` é dedutível
 * — preenche o draft automaticamente antes de validar.
 */
export async function autoFillDoctorIfSingle(
  draftService: OperationDraftService,
  userRepo: UserRepository,
  context: ToolContext,
): Promise<void> {
  const accessible = context.accessibleDoctorIds || [];
  if (accessible.length !== 1) return;
  const current = await draftService.getCurrentOfType(
    context.conversationId,
    'create_sc',
  );
  if (!current || current.fields.doctorId) return;
  const doctor = await userRepo.findOne({ id: accessible[0] } as any);
  await draftService.setFields(context.conversationId, 'create_sc', {
    doctorId: accessible[0],
    doctorLabel: doctor?.name ?? undefined,
  });
}
