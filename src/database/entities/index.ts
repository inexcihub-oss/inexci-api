// ============================================
// NOVA ARQUITETURA DE ENTIDADES
// ============================================

// Importar todas as entidades primeiro
import { User, UserRole, UserStatus } from './user.entity';
import { DoctorProfile, SubscriptionStatus } from './doctor-profile.entity';
import {
  TeamMember,
  TeamMemberRole,
  TeamMemberStatus,
} from './team-member.entity';
import { Patient } from './patient.entity';
import { Hospital } from './hospital.entity';
import { HealthPlan } from './health-plan.entity';
import { Supplier } from './supplier.entity';
import { Cid } from './cid.entity';
import { Procedure } from './procedure.entity';
import { SurgeryRequest, SurgeryRequestStatus } from './surgery-request.entity';
import { SurgeryRequestProcedure } from './surgery-request-procedure.entity';
import { OpmeItem } from './opme-item.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { StatusUpdate } from './status-update.entity';
import { Document } from './document.entity';
import { DefaultDocumentClinic } from './default-document-clinic.entity';
import { Chat } from './chat.entity';
import { ChatMessage } from './chat-message.entity';
import { Notification, NotificationType } from './notification.entity';
import { UserNotificationSettings } from './user-notification-settings.entity';
import { RecoveryCode } from './recovery-code.entity';

// Re-exportar tudo
// USUÁRIOS (fazem login)
export { User, UserRole, UserStatus };
export { DoctorProfile, SubscriptionStatus };
export { TeamMember, TeamMemberRole, TeamMemberStatus };

// ENTIDADES DE NEGÓCIO (não fazem login)
export { Patient };
export { Hospital };
export { HealthPlan };
export { Supplier };

// DADOS DE REFERÊNCIA
export { Cid };
export { Procedure };

// SOLICITAÇÃO CIRÚRGICA E RELACIONADOS
export { SurgeryRequest, SurgeryRequestStatus };
export { SurgeryRequestProcedure };
export { OpmeItem };
export { SurgeryRequestQuotation };
export { StatusUpdate };

// DOCUMENTOS
export { Document };
export { DefaultDocumentClinic };

// COMUNICAÇÃO
export { Chat };
export { ChatMessage };
export { Notification, NotificationType };
export { UserNotificationSettings };

// AUTENTICAÇÃO
export { RecoveryCode };

// Array apenas com classes de entidade (sem enums) para TypeORM
export const ENTITIES = [
  User,
  DoctorProfile,
  TeamMember,
  Patient,
  Hospital,
  HealthPlan,
  Supplier,
  Cid,
  Procedure,
  SurgeryRequest,
  SurgeryRequestProcedure,
  OpmeItem,
  SurgeryRequestQuotation,
  StatusUpdate,
  Document,
  DefaultDocumentClinic,
  Chat,
  ChatMessage,
  Notification,
  UserNotificationSettings,
  RecoveryCode,
];
