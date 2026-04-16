// ============================================
// NOVA ARQUITETURA DE ENTIDADES (v3)
// ============================================

// Importar todas as entidades primeiro
import { User, UserRole, UserStatus } from './user.entity';
import { DoctorProfile } from './doctor-profile.entity';
import {
  UserDoctorAccess,
  UserDoctorAccessStatus,
} from './user-doctor-access.entity';
import { Patient } from './patient.entity';
import { Hospital } from './hospital.entity';
import { HealthPlan } from './health-plan.entity';
import { Supplier } from './supplier.entity';
import { Procedure } from './procedure.entity';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
  SurgeryRequestPriority,
} from './surgery-request.entity';
import { OpmeItem } from './opme-item.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { SurgeryRequestAnalysis } from './surgery-request-analysis.entity';
import { SurgeryRequestBilling } from './surgery-request-billing.entity';
import { SurgeryRequestTemplate } from './surgery-request-template.entity';
import { Contestation } from './contestation.entity';
import { SurgeryRequestTussItem } from './surgery-request-tuss-item.entity';
import { StatusUpdate } from './status-update.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from './surgery-request-activity.entity';
import { Document } from './document.entity';
import { DefaultDocumentClinic } from './default-document-clinic.entity';
import { Chat } from './chat.entity';
import { ChatMessage } from './chat-message.entity';
import { Notification, NotificationType } from './notification.entity';
import { UserNotificationSettings } from './user-notification-settings.entity';
import { RecoveryCode } from './recovery-code.entity';
import { RefreshToken } from './refresh-token.entity';
import { SubscriptionPlan } from './subscription-plan.entity';
import {
  WhatsappMessageLog,
  WhatsappMessageStatus,
} from './whatsapp-message-log.entity';
import { ReportSection } from './report-section.entity';

// Re-exportar tudo
// USUÁRIOS E ACESSO
export { User, UserRole, UserStatus };
export { DoctorProfile };
export { UserDoctorAccess, UserDoctorAccessStatus };

// ENTIDADES DE NEGÓCIO (não fazem login)
export { Patient };
export { Hospital };
export { HealthPlan };
export { Supplier };

// DADOS DE REFERÊNCIA
export { Procedure };

// SOLICITAÇÃO CIRÚRGICA E RELACIONADOS
export { SurgeryRequest, SurgeryRequestStatus, SurgeryRequestPriority };
export { OpmeItem };
export { SurgeryRequestQuotation };
export { SurgeryRequestAnalysis };
export { SurgeryRequestBilling };
export { SurgeryRequestTemplate };
export { Contestation };
export { SurgeryRequestTussItem };
export { StatusUpdate };
export { SurgeryRequestActivity, ActivityType };

// DOCUMENTOS
export { Document };
export { DefaultDocumentClinic };

// COMUNICAÇÃO
export { Chat };
export { ChatMessage };
export { Notification, NotificationType };
export { UserNotificationSettings };
export { WhatsappMessageLog, WhatsappMessageStatus };
export { ReportSection };

// PLANOS DE ASSINATURA
export { SubscriptionPlan };

// AUTENTICAÇÃO
export { RecoveryCode };
export { RefreshToken };

// Array apenas com classes de entidade (sem enums) para TypeORM
export const ENTITIES = [
  User,
  DoctorProfile,
  UserDoctorAccess,
  Patient,
  Hospital,
  HealthPlan,
  Supplier,
  Procedure,
  SurgeryRequest,
  OpmeItem,
  SurgeryRequestQuotation,
  SurgeryRequestAnalysis,
  SurgeryRequestBilling,
  SurgeryRequestTemplate,
  Contestation,
  SurgeryRequestTussItem,
  StatusUpdate,
  SurgeryRequestActivity,
  Document,
  DefaultDocumentClinic,
  Chat,
  ChatMessage,
  Notification,
  UserNotificationSettings,
  RecoveryCode,
  RefreshToken,
  SubscriptionPlan,
  WhatsappMessageLog,
  ReportSection,
];
