import {
  TOOL_PII_ALLOWLIST,
  isCategoryAllowedForTool,
  PiiAllowlistViolationError,
} from './tool-pii-allowlist';
import { tokenizePii } from './tool-pii-helpers';
import { registeredToolNames } from '../tools/registered-tools.fixture-spec';

describe('tool-pii-allowlist', () => {
  describe('sincronia com o registro de tools', () => {
    const registradas = registeredToolNames();

    it('não tem chave órfã (toda chave é uma tool registrada)', () => {
      const orfas = Object.keys(TOOL_PII_ALLOWLIST).filter(
        (nome) => !registradas.has(nome),
      );
      expect(orfas).toEqual([]);
    });

    it('toda tool registrada tem entrada (mesmo que vazia)', () => {
      const semEntrada = [...registradas].filter(
        (nome) => !(nome in TOOL_PII_ALLOWLIST),
      );
      expect(semEntrada).toEqual([]);
    });
  });

  describe('TOOL_PII_ALLOWLIST', () => {
    it('query_surgery_requests NÃO tokeniza patient_name/hospital_name (PII de negócio fica em claro após refatoração de draft)', () => {
      expect(TOOL_PII_ALLOWLIST.query_surgery_requests).not.toContain(
        'patient_name',
      );
      expect(TOOL_PII_ALLOWLIST.query_surgery_requests).not.toContain(
        'hospital_name',
      );
      expect(TOOL_PII_ALLOWLIST.query_surgery_requests).toContain('protocol');
    });

    it('manage_documents só pode tokenizar protocol (sem nome de paciente)', () => {
      expect(TOOL_PII_ALLOWLIST.manage_documents).toEqual(['protocol']);
    });

    it('manage_tuss_items, manage_opme_items e manage_report_images só tokenizam protocol', () => {
      expect(TOOL_PII_ALLOWLIST.manage_tuss_items).toEqual(['protocol']);
      expect(TOOL_PII_ALLOWLIST.manage_opme_items).toEqual(['protocol']);
      expect(TOOL_PII_ALLOWLIST.manage_report_images).toEqual(['protocol']);
    });

    it('set_health_plan e set_hospital tokenizam apenas o protocol (nomes de negócio em claro)', () => {
      expect(TOOL_PII_ALLOWLIST.set_health_plan).toEqual(['protocol']);
      expect(TOOL_PII_ALLOWLIST.set_hospital).toEqual(['protocol']);
    });

    it('search_tuss_codes e search_cid_codes não tokenizam nada (catálogo público)', () => {
      expect(TOOL_PII_ALLOWLIST.search_tuss_codes).toEqual([]);
      expect(TOOL_PII_ALLOWLIST.search_cid_codes).toEqual([]);
    });

    it('draft_update e draft_status tokenizam CPF/telefone/e-mail/nascimento; draft_cancel nada', () => {
      for (const tool of ['draft_update', 'draft_status']) {
        expect(TOOL_PII_ALLOWLIST[tool]).toEqual(
          expect.arrayContaining(['cpf', 'phone', 'email', 'birth_date']),
        );
      }
      expect(TOOL_PII_ALLOWLIST.draft_cancel).toEqual([]);
    });
  });

  describe('isCategoryAllowedForTool', () => {
    it('retorna true para combinação válida (cpf em query_patients)', () => {
      expect(isCategoryAllowedForTool('query_patients', 'cpf')).toBe(true);
    });

    it('retorna false para combinação inválida', () => {
      expect(isCategoryAllowedForTool('manage_documents', 'patient_name')).toBe(
        false,
      );
    });

    it('retorna false para tool desconhecida', () => {
      expect(isCategoryAllowedForTool('tool_inexistente', 'protocol')).toBe(
        false,
      );
    });
  });

  describe('tokenizePii', () => {
    const context = {
      userId: 'u',
      phone: 'p',
      accessibleDoctorIds: [],
      conversationId: 'c',
    };

    it('lança PiiAllowlistViolationError com toolName e category quando a categoria é proibida', () => {
      try {
        tokenizePii(context, 'manage_documents', 'cpf', '12345678901');
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(PiiAllowlistViolationError);
        expect((err as PiiAllowlistViolationError).toolName).toBe(
          'manage_documents',
        );
        expect((err as PiiAllowlistViolationError).category).toBe('cpf');
      }
    });
  });
});
