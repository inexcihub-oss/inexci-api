// ============================================
// NOVA ARQUITETURA DE ENTIDADES (v4)
// ============================================

import { User, UserRole, UserStatus } from './user.entity';
import { DoctorProfile } from './doctor-profile.entity';
import { DoctorHeader } from './doctor-header.entity';
import {
  UserDoctorAccess,
  UserDoctorAccessStatus,
} from './user-doctor-access.entity';
import { Patient } from './patient.entity';
import { Hospital } from './hospital.entity';
import { HealthPlan } from './health-plan.entity';
import { Manufacturer } from './manufacturer.entity';
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
import { Contestation, ContestationTypeEnum } from './contestation.entity';
import { SurgeryRequestTussItem } from './surgery-request-tuss-item.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from './surgery-request-activity.entity';
import { Document } from './document.entity';
import { Notification, NotificationType } from './notification.entity';
import { UserNotificationSettings } from './user-notification-settings.entity';
import { RecoveryCode } from './recovery-code.entity';
import { SubscriptionPlan, BillingPeriod } from './subscription-plan.entity';
import { Subscription, SubscriptionStatus } from './subscription.entity';
import { PaymentMethod } from './payment-method.entity';
import { Invoice, InvoiceStatus } from './invoice.entity';
import { SubscriptionQuotaPeriod } from './subscription-quota-period.entity';
import { PaymentGatewayEvent } from './payment-gateway-event.entity';
import { ReportSection } from './report-section.entity';
import {
  NotificationSendLog,
  NotificationChannel,
  NotificationSendStatus,
  NotificationDirection,
  NotificationSendType,
} from './notification-send-log.entity';
import { StaleNotificationLog } from './stale-notification-log.entity';
import { WhatsappConversation } from './whatsapp-conversation.entity';
import { WhatsappConversationMessage } from './whatsapp-conversation-message.entity';
import { AiKnowledgeChunk } from './ai-knowledge-chunk.entity';
import { AiTokenUsageLog } from './ai-token-usage-log.entity';
import { AiPiiRedactionLog } from './ai-pii-redaction-log.entity';

// Re-exportar tudo
// USUÁRIOS E ACESSO
export { User, UserRole, UserStatus };
export { DoctorProfile };
export { DoctorHeader };
export { UserDoctorAccess, UserDoctorAccessStatus };

// ENTIDADES DE NEGÓCIO (não fazem login)
export { Patient };
export { Hospital };
export { HealthPlan };
export { Manufacturer };
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
export { Contestation, ContestationTypeEnum };
export { SurgeryRequestTussItem };
export { SurgeryRequestActivity, ActivityType };

// DOCUMENTOS
export { Document };

// COMUNICAÇÃO
export { Notification, NotificationType };
export { UserNotificationSettings };
export { ReportSection };

// PLANOS DE ASSINATURA / BILLING
export { SubscriptionPlan, BillingPeriod };
export { Subscription, SubscriptionStatus };
export { PaymentMethod };
export { Invoice, InvoiceStatus };
export { SubscriptionQuotaPeriod };
export { PaymentGatewayEvent };

// AUTENTICAÇÃO
export { RecoveryCode };

// OBSERVABILIDADE
export {
  NotificationSendLog,
  NotificationChannel,
  NotificationSendStatus,
  NotificationDirection,
  NotificationSendType,
};
export { StaleNotificationLog };

// IA / WHATSAPP CONVERSAÇÃO
export { WhatsappConversation };
export { WhatsappConversationMessage };
export { AiKnowledgeChunk };
export { AiTokenUsageLog };
export { AiPiiRedactionLog };

// Array apenas com classes de entidade (sem enums) para TypeORM
export const ENTITIES = [
  User,
  DoctorProfile,
  DoctorHeader,
  UserDoctorAccess,
  Patient,
  Hospital,
  HealthPlan,
  Manufacturer,
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
  SurgeryRequestActivity,
  Document,
  Notification,
  UserNotificationSettings,
  RecoveryCode,
  SubscriptionPlan,
  Subscription,
  PaymentMethod,
  Invoice,
  SubscriptionQuotaPeriod,
  PaymentGatewayEvent,
  ReportSection,
  NotificationSendLog,
  StaleNotificationLog,
  WhatsappConversation,
  WhatsappConversationMessage,
  AiKnowledgeChunk,
  AiTokenUsageLog,
  AiPiiRedactionLog,
];
