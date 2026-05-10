import { buildPendencyTools } from './pendency.tools';
import { ToolContext } from './tool.interface';
import { PiiVaultService } from '../services/pii-vault.service';

const mockPendencyValidator = { validateForStatus: jest.fn() };
const mockSurgeryRequestRepo = {
  findOneSimple: jest.fn(),
  findMany: jest.fn(),
};

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
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(
        async (where) => {
          if (where?.protocol === '468131') {
            return {
              id: 'req-468131',
              protocol: '468131',
              status: 1,
              doctorId: 'doctor-1',
            };
          }
          return null;
        },
      );
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
      mockSurgeryRequestRepo.findOneSimple.mockImplementation(
        async (where) => {
          if (where?.protocol === '468131') {
            return {
              id: 'req-468131',
              protocol: '468131',
              status: 1,
              doctorId: 'doctor-1',
            };
          }
          return null;
        },
      );
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
});
