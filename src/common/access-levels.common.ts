import { UserRole } from 'src/database/entities/user.entity';

/**
 * Controle de acesso por rota e método HTTP
 *
 * Na nova arquitetura, apenas 3 tipos de usuário fazem login:
 * - ADMIN: Acesso total à plataforma
 * - DOCTOR: Médico (dono da conta)
 * - COLLABORATOR: Colaborador do médico (permissões via TeamMember)
 */
export default {
  '/auth/me': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/users': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
    PUT: [UserRole.ADMIN, UserRole.DOCTOR],
  },
  '/users/one': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR],
  },
  '/users/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR],
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR],
  },
  '/users/profile': {
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
    PUT: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/one': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/simple': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
  },
  '/surgery-requests/send': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/schedule': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/to-invoice': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/invoice': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/receive': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/cancel': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
  },
  '/surgery-requests/surgery-dates': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/opme': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/procedures': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/procedures/authorize': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/quotations': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    PUT: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/documents': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/documents-key': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/pendencies': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/pendencies/grouped/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/pendencies/summary/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/pendencies/check/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/pendencies/validate/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/pendencies/quick-summary/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/surgery-requests/pendencies/:id/complete': {
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/cid': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/contest': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/:id/status': {
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/surgery-requests/:id/basic': {
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/procedures': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/suppliers': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR],
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR],
  },

  '/patients': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR],
  },

  '/hospitals': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR],
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR],
  },

  '/health_plans': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR],
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR],
  },

  '/chats/messages': {
    POST: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/reports/dashboard': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/reports/temporal-evolution': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/reports/monthly-evolution': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/reports/average-completion-time': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  '/reports/pending-notifications': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },

  // Team Members (equipe do médico)
  '/team-members': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
  },
  '/team-members/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR],
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR],
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR],
  },

  // Doctor Profiles
  '/doctor-profiles': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    POST: [UserRole.ADMIN, UserRole.DOCTOR],
  },
  '/doctor-profiles/:id': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    PATCH: [UserRole.ADMIN, UserRole.DOCTOR],
  },

  // Notifications
  '/notifications': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/notifications/settings': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
    PUT: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/notifications/unread-count': {
    GET: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/notifications/:id/read': {
    PUT: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/notifications/read-all': {
    PUT: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
  '/notifications/:id': {
    DELETE: [UserRole.ADMIN, UserRole.DOCTOR, UserRole.COLLABORATOR],
  },
};
