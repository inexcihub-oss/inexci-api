import { UserPvs } from '.';

export default {
  '/auth/me': {
    GET: [
      UserPvs.doctor,
      UserPvs.collaborator,
      UserPvs.hospital,
      UserPvs.patient,
      UserPvs.supplier,
    ],
  },

  '/users': {
    GET: [UserPvs.doctor],
    POST: [UserPvs.doctor],
    PUT: [UserPvs.doctor],
  },
  '/users/one': {
    GET: [UserPvs.doctor],
  },
  '/users/complete-register': {
    POST: [UserPvs.patient, UserPvs.hospital, UserPvs.supplier],
  },
  '/users/complete-register/validate-link': {
    GET: [UserPvs.patient, UserPvs.hospital, UserPvs.supplier],
  },

  '/surgery-requests': {
    GET: [
      UserPvs.doctor,
      UserPvs.collaborator,
      UserPvs.hospital,
      UserPvs.patient,
      UserPvs.supplier,
    ],
    POST: [UserPvs.doctor],
    PUT: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/one': {
    GET: [
      UserPvs.doctor,
      UserPvs.collaborator,
      UserPvs.hospital,
      UserPvs.patient,
      UserPvs.supplier,
    ],
  },
  '/surgery-requests/simple': {
    POST: [UserPvs.doctor],
  },
  '/surgery-requests/send': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/schedule': {
    POST: [UserPvs.doctor, UserPvs.collaborator, UserPvs.patient],
  },
  '/surgery-requests/to-invoice': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/invoice': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/receive': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/cancel': {
    POST: [UserPvs.doctor],
  },
  '/surgery-requests/surgery-dates': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/opme': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/procedures': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/procedures/authorize': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/quotations': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
    PUT: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/documents': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
    DELETE: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/documents-key': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/pendencies': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/pendencies/grouped/:id': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/pendencies/summary/:id': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/pendencies/check/:id': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/pendencies/validate/:id': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/pendencies/quick-summary/:id': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },
  '/surgery-requests/pendencies/:id/complete': {
    PATCH: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/cid': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/contest': {
    POST: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/surgery-requests/complaint': {
    POST: [UserPvs.patient],
  },

  '/surgery-requests/dateExpired': {
    POST: [UserPvs.patient],
  },

  '/surgery-requests/:id/status': {
    PATCH: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/procedures': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/suppliers': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/patients': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/hospitals': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/health_plans': {
    GET: [UserPvs.doctor, UserPvs.collaborator],
  },

  '/chats/messages': {
    POST: [
      UserPvs.doctor,
      UserPvs.collaborator,
      UserPvs.patient,
      UserPvs.hospital,
      UserPvs.supplier,
    ],
  },

  '/reports/dashboard': {
    GET: [
      UserPvs.doctor,
      UserPvs.collaborator,
      UserPvs.patient,
      UserPvs.hospital,
      UserPvs.supplier,
    ],
  },
};
