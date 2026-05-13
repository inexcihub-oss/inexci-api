import { buildPendencyTools } from './pendency.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';

const mockPendencyValidator = { validateForStatus: jest.fn() };
const mockSurgeryRequestRepo = {
  findOneSimple: jest.fn(),
  findMany: jest.fn(),
};
const mockDocumentRepo = { findMany: jest.fn() };

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

describe('PendencyTools', () => {
  const tools = buildPendencyTools(
    mockPendencyValidator as any,
    mockSurgeryRequestRepo as any,
    mockDocumentRepo as any,
  );
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  describe('get_pendencies', () => {
    it('deve listar pendências bloqueantes e concluídas', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        status: 1,
        doctorId: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: false,
        pendencies: [
          {
            key: 'patient_data',
            name: 'Paciente não vinculado',
            isComplete: false,
            isOptional: false,
            checkItems: [
              { label: 'Nome do paciente', done: false },
              { label: 'CPF', done: true },
            ],
          },
          {
            key: 'tuss_procedures',
            name: 'CID informado',
            isComplete: true,
            isOptional: false,
            checkItems: [],
          },
        ],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('Para avançar, faça:');
      expect(result).toContain('Paciente não vinculado');
      expect(result).toContain('Nome do paciente');
      expect(result).toContain('Ação recomendada agora');
      expect(result).toContain('Parâmetros mínimos');
    });

    it('deve retornar mensagem positiva se sem pendências', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0001',
        status: 1,
        doctorId: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: true,
        pendencies: [],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('não tem pendências');
    });

    it('deve negar acesso se doctorId não acessível', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-2',
        doctorId: 'other-doctor',
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: 'req-2' },
        baseContext,
      );

      expect(result).toContain('permissão');
    });

    it('deve resolver pendências por protocolo SC-XXXX', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.id === 'SC-664980') {
          throw new Error('não deveria consultar SC como UUID');
        }
        if (where?.protocol === 'SC-664980') {
          return {
            id: 'req-77',
            protocol: 'SC-664980',
            doctorId: 'doctor-1',
          };
        }
        return null;
      });

      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Enviada',
        canAdvance: true,
        pendencies: [],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: 'SC-664980' },
        baseContext,
      );

      expect(mockPendencyValidator.validateForStatus).toHaveBeenCalledWith(
        'req-77',
      );
      expect(result).toContain('SC-664980');
    });

    it('deve aceitar identifier como alias de surgeryRequestId', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-8',
        protocol: 'SC-217923',
        doctorId: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: false,
        pendencies: [
          {
            key: 'patient_data',
            name: 'Dados do Paciente',
            isComplete: false,
            isOptional: false,
            checkItems: [{ label: 'Telefone', done: false }],
          },
        ],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { identifier: 'SC-217923' },
        baseContext,
      );

      expect(mockPendencyValidator.validateForStatus).toHaveBeenCalledWith(
        'req-8',
      );
      expect(result).toContain('Para avançar, faça:');
      expect(result).toContain('Telefone');
    });

    it('com vault ativo, tokeniza o protocolo retornado para a IA', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-vault-1',
        protocol: 'SC-664980',
        status: 1,
        doctorId: 'doctor-1',
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: false,
        pendencies: [
          {
            key: 'patient_data',
            name: 'Dados do Paciente',
            isComplete: false,
            isOptional: false,
            checkItems: [{ label: 'Telefone', done: false }],
          },
        ],
      });

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');
      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: 'req-vault-1' },
        { ...baseContext, piiVault },
      );

      expect(result).not.toContain('SC-664980');
      expect(result).toContain('{{protocol_1}}');
      expect(piiVault.detokenize('conv-1', result)).toContain('SC-664980');
    });

    // Regressão: print 2026-05-10 — usuário pediu pendências da SC e recebeu
    // "Não consegui acessar as pendências da solicitação SC-SC-468131".
    // Causa: o vault armazenava o protocol já com prefixo "SC-"; a IA copiava
    // o padrão "SC-{{protocol_n}}" como argumento, o detokenize gerava
    // "SC-SC-468131" e o `findOneSimple` não encontrava nada.
    // Após o fix: o vault guarda só o sufixo (ex.: "468131"); o argumento
    // "SC-{{protocol_n}}" detokeniza para "SC-468131" e a tool resolve.
    it('resolve a SC mesmo quando a IA passa "SC-{{protocol_n}}" como argumento (regressão SC-SC-)', async () => {
      // Banco devolve o protocol cru (como o `generate_protocol()` em SQL).
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.protocol === '468131') {
          return {
            id: 'req-468131',
            protocol: '468131',
            status: 1,
            doctorId: 'doctor-1',
          };
        }
        return null;
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: true,
        pendencies: [],
      });

      const piiVault = new PiiVaultService();
      piiVault.startSession('conv-1');
      // Simula um turno anterior de `list_surgery_requests` que tokenizou o
      // protocol cru e retornou "SC-{{protocol_1}}" para o LLM.
      const protocolToken = piiVault.tokenize('conv-1', '468131', 'protocol');
      expect(protocolToken).toBe('{{protocol_1}}');

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: `SC-${protocolToken}` },
        { ...baseContext, piiVault },
      );

      expect(mockPendencyValidator.validateForStatus).toHaveBeenCalledWith(
        'req-468131',
      );
      expect(result).not.toContain('Solicitação não encontrada');
      const detokenized = piiVault.detokenize('conv-1', result);
      expect(detokenized).toContain('SC-468131');
      expect(detokenized).not.toContain('SC-SC-468131');
    });

    // Regressão: print 2026-05-10 (segunda recorrência) — usuário continuou
    // recebendo "Não consegui acessar as pendências da solicitação SC-SC-468131"
    // mesmo após o fix do `stripScPrefix`. Causa: o `PiiVaultService` é
    // PERSISTIDO em Redis (TTL 1h). Bindings criados ANTES do fix gravavam
    // realValue="SC-468131"; ao restaurar a sessão, o detokenize de
    // "SC-{{protocol_n}}" gerava "SC-SC-468131" e o lookup falhava.
    // Defesa correta: o `restoreSession` do `PiiVaultService` normaliza o
    // realValue de protocol (strip recursivo de SC-), de modo que mesmo
    // bindings legados são reescritos para o sufixo cru. O lookup permanece
    // estrito (não tolera SC-SC-XXXX) — quem trata duplicação textual da IA
    // é o `collapseDuplicatedScPrefixes` aplicado no orchestrator.
    it('resolve a SC mesmo quando o vault tem binding legado com realValue="SC-XXXX" (regressão SC-SC-)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.protocol === '468131') {
          return {
            id: 'req-468131',
            protocol: '468131',
            status: 1,
            doctorId: 'doctor-1',
          };
        }
        return null;
      });
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Pendente',
        canAdvance: true,
        pendencies: [],
      });

      const piiVault = new PiiVaultService();
      // Restaura binding LEGADO do Redis (versão antiga gravava com SC-).
      piiVault.restoreSession('conv-1', [
        {
          token: '{{protocol_1}}',
          category: 'protocol',
          realValue: 'SC-468131',
        },
      ]);

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: 'SC-{{protocol_1}}' },
        { ...baseContext, piiVault },
      );

      expect(mockPendencyValidator.validateForStatus).toHaveBeenCalledWith(
        'req-468131',
      );
      expect(result).not.toContain('Solicitação não encontrada');
      const detokenized = piiVault.detokenize('conv-1', result);
      expect(detokenized).toContain('SC-468131');
      expect(detokenized).not.toContain('SC-SC-468131');
    });

    it('deve tentar localizar por nome do paciente quando não achar por id/protocolo', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(null);
      mockSurgeryRequestRepo.findMany.mockResolvedValue([
        {
          id: 'req-10',
          protocol: 'SC-999001',
          doctorId: 'doctor-1',
          patient: { name: 'Eduardo Luiz Teixeira' },
        },
      ]);
      mockPendencyValidator.validateForStatus.mockResolvedValue({
        statusLabel: 'Enviada',
        canAdvance: true,
        pendencies: [],
      });

      const tool = getTool('get_pendencies');
      const result = await tool.execute(
        { surgeryRequestId: 'Eduardo Luiz Teixeira' },
        baseContext,
      );

      expect(result).toContain('SC-999001');
    });
  });

  describe('get_workflow_requirements', () => {
    it('default (sem args) devolve requisitos de CRIAÇÃO — sem TUSS/OPME/laudo na lista', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute({}, baseContext);

      expect(result).toContain('Criar uma nova SC');
      expect(result).toContain('Paciente');
      expect(result).toContain('Procedimento');
      expect(result).toContain('Prioridade');
      // Hospital e convênio aparecem como OPCIONAIS na criação
      expect(result).toMatch(/Hospital.*opcional/i);
      expect(result).toMatch(/Conv[êe]nio.*opcional/i);
      // Reforço explícito: TUSS/OPME/laudo só para enviar
      expect(result).toMatch(/TUSS.*OPME.*laudo.*N[ÃA]O.*exigidos.*criar/i);
    });

    it('com 1 médico acessível, NÃO pede para informar médico (assume automático)', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute({ stage: 'create' }, baseContext);

      expect(result).toMatch(/M[ée]dico.*assumido automaticamente/i);
      expect(result).not.toMatch(/precisa indicar qual/i);
    });

    it('com múltiplos médicos acessíveis, EXIGE indicar o médico', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute(
        { stage: 'create' },
        { ...baseContext, accessibleDoctorIds: ['doctor-1', 'doctor-2'] },
      );

      expect(result).toMatch(/precisa indicar qual/i);
    });

    it('stage=send devolve as pendências bloqueantes do PENDING (Enviar)', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute({ stage: 'send' }, baseContext);

      expect(result).toContain('Enviar a SC');
      expect(result).toContain('Dados do Paciente');
      expect(result).toContain('Hospital');
      expect(result).toContain('Procedimentos (TUSS)');
      expect(result).toContain('Itens OPME');
      expect(result).toContain('Laudo Médico');
      // Item OPME deve mencionar a opção de marcar que NÃO há OPME
      expect(result).toMatch(/marcar que N[ÃA]O h[áa] OPME/i);
      // Laudo deve mencionar assinatura
      expect(result).toMatch(/assinatura do m[ée]dico/i);
    });

    it('stage=schedule devolve pendências do IN_SCHEDULING', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute({ stage: 'schedule' }, baseContext);

      expect(result).toContain('Agendar');
      expect(result).toContain('Definir datas disponíveis');
      expect(result).toContain('Paciente confirmar data');
    });

    it('stage=invoice devolve pendência de confirmar recebimento', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute({ stage: 'invoice' }, baseContext);

      expect(result).toContain('Confirmar recebimento');
    });

    it('stage=all combina criação + todos os status com pendências', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute({ stage: 'all' }, baseContext);

      expect(result).toContain('Criar uma nova SC');
      expect(result).toContain('Pendente');
      expect(result).toContain('Em Agendamento');
      expect(result).toContain('Faturada');
    });

    it('stage inválido cai no default (create)', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute(
        { stage: 'qualquer-coisa' },
        baseContext,
      );

      expect(result).toContain('Criar uma nova SC');
    });

    it('sem userId no contexto, nega acesso', async () => {
      const tool = getTool('get_workflow_requirements');
      const result = await tool.execute(
        {},
        { ...baseContext, userId: undefined as any },
      );

      expect(result).toContain('Acesso negado');
    });
  });

  describe('list_post_surgery_required_docs', () => {
    beforeEach(() => {
      mockDocumentRepo.findMany.mockReset();
      mockSurgeryRequestRepo.findOneSimple.mockReset();
    });

    it('rejeita sem userId', async () => {
      const tool = getTool('list_post_surgery_required_docs');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        { ...baseContext, userId: undefined as any },
      );
      expect(result).toContain('Acesso negado');
    });

    it('quando NADA está anexado, lista todos como faltando e bloqueia mark_performed', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        doctorId: 'doctor-1',
      });
      mockDocumentRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_post_surgery_required_docs');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('SC-0042');
      expect(result).toMatch(/Ficha da sala de cirurgia.*\(obrigatório\)/i);
      expect(result).toMatch(
        /Documento de autorização da cirurgia.*\(obrigatório\)/i,
      );
      expect(result).toMatch(/Imagens.*\(opcional\)/i);
      expect(result).toMatch(/\[faltando\]/);
      expect(result).toMatch(/Faltam 2 documento\(s\) obrigatório/i);
      expect(result).toMatch(/manage_documents/);
    });

    it('quando todos os obrigatórios estão anexados, libera mark_performed', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        doctorId: 'doctor-1',
      });
      mockDocumentRepo.findMany.mockResolvedValue([
        { type: 'surgery_room' },
        { type: 'surgery_auth_document' },
      ]);

      const tool = getTool('list_post_surgery_required_docs');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toMatch(
        /Ficha da sala.*\[anexado\]|\[anexado\].*Ficha da sala/i,
      );
      expect(result).toMatch(
        /pode prosseguir com `plan_actions\(intent="mark_performed"\)`/i,
      );
      // Há ainda o opcional (surgery_images) faltando — deve avisar.
      expect(result).toMatch(/opcionais ainda não anexados/i);
    });

    it('quando obrigatórios e opcionais estão todos anexados, sem aviso de opcional', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-1',
        protocol: 'SC-0042',
        doctorId: 'doctor-1',
      });
      mockDocumentRepo.findMany.mockResolvedValue([
        { type: 'surgery_room' },
        { type: 'surgery_auth_document' },
        { type: 'surgery_images' },
      ]);

      const tool = getTool('list_post_surgery_required_docs');
      const result = await tool.execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toMatch(/pode prosseguir/i);
      expect(result).not.toMatch(/opcionais ainda não anexados/i);
    });

    it('rejeita quando o doctorId da SC não é acessível ao usuário', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue({
        id: 'req-x',
        protocol: 'SC-9999',
        doctorId: 'doctor-other',
      });

      const tool = getTool('list_post_surgery_required_docs');
      const result = await tool.execute(
        { surgeryRequestId: 'req-x' },
        baseContext,
      );

      expect(result).toMatch(/permissão/i);
      expect(mockDocumentRepo.findMany).not.toHaveBeenCalled();
    });

    it('aceita identifier como alias de surgeryRequestId (protocolo SC-XXXX)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(async (where) => {
        if (where?.protocol === '0042') {
          return { id: 'req-1', protocol: '0042', doctorId: 'doctor-1' };
        }
        return null;
      });
      mockDocumentRepo.findMany.mockResolvedValue([]);

      const tool = getTool('list_post_surgery_required_docs');
      const result = await tool.execute({ identifier: 'SC-0042' }, baseContext);

      expect(result).toContain('SC-0042');
      expect(result).toMatch(/Faltam 2/);
    });
  });
});
