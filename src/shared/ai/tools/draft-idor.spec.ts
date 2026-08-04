import { resolveAuthorizedRequest } from './_helpers/resolve-surgery-request';

describe('Tools de draft — IDOR cross-tenant', () => {
  const scDaVitima = {
    id: '11111111-1111-1111-1111-111111111111',
    protocol: '468131',
    doctorId: 'medico-de-outra-clinica',
    ownerId: 'owner-b',
  };

  const repo = {
    findOneSimple: jest.fn().mockImplementation(({ id, protocol }) => {
      if (id === scDaVitima.id) return Promise.resolve(scDaVitima);
      if (protocol === scDaVitima.protocol) return Promise.resolve(scDaVitima);
      return Promise.resolve(null);
    }),
  };

  const contextoDoAtacante = {
    userId: 'atacante',
    ownerId: 'owner-a',
    accessibleDoctorIds: ['medico-da-clinica-a'],
    conversationId: 'conv-1',
  };

  it('recusa SC de outra clinica informada por UUID', async () => {
    const { request, error } = await resolveAuthorizedRequest(
      repo as any,
      scDaVitima.id,
      contextoDoAtacante as any,
    );
    expect(request).toBeNull();
    expect(error).toMatch(/permissão/i);
  });

  it('recusa SC de outra clinica informada por protocolo de 6 digitos', async () => {
    const { request, error } = await resolveAuthorizedRequest(
      repo as any,
      'SC-468131',
      contextoDoAtacante as any,
    );
    expect(request).toBeNull();
    expect(error).toMatch(/permissão/i);
  });

  it('o helper de transicao de draft usa a versao autorizada', () => {
    // Barreira de regressao: o modulo nao pode mais importar a versao sem
    // checagem de permissao, senao o IDOR volta.
    const fonte = require('fs').readFileSync(
      require.resolve('./flow-draft-transition/_helpers'),
      'utf8',
    );
    expect(fonte).toContain('resolveAuthorizedRequest');
    expect(fonte).not.toMatch(/\bresolveSurgeryRequest\b/);
  });
});
