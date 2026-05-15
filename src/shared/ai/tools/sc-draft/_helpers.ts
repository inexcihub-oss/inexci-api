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
  if (accessible.length === 0) return;
  const current = await draftService.getCurrentOfType(
    context.conversationId,
    'create_sc',
  );
  if (!current || current.fields.doctorId) return;

  // 1) Único médico acessível → auto-preenche.
  // 2) Múltiplos médicos acessíveis, MAS o próprio usuário é um deles
  //    (i.e. o usuário do WhatsApp é médico) → assume "self" como
  //    default, evitando a pergunta "qual médico responsável?" no caso
  //    típico do médico falando da própria conta. O LLM ainda pode
  //    sobrescrever via `draft_update(create_sc, doctorId, …)` se o
  //    usuário esclarecer.
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
