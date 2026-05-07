import {
  TOOL_PII_ALLOWLIST,
  assertCategoryAllowed,
  getAllowedCategoriesForTool,
  isCategoryAllowedForTool,
  PiiAllowlistViolationError,
} from './tool-pii-allowlist';

describe('tool-pii-allowlist', () => {
  describe('TOOL_PII_ALLOWLIST', () => {
    it('inclui get_surgery_request_status com patient_name e hospital_name', () => {
      expect(TOOL_PII_ALLOWLIST.get_surgery_request_status).toContain(
        'patient_name',
      );
      expect(TOOL_PII_ALLOWLIST.get_surgery_request_status).toContain(
        'hospital_name',
      );
    });

    it('NÃO permite conteúdo clínico longo em update_request_clinical_data', () => {
      const allowed = TOOL_PII_ALLOWLIST.update_request_clinical_data;
      expect(allowed).not.toContain('medical_report');
      expect(allowed).not.toContain('patient_history');
      expect(allowed).not.toContain('diagnosis');
      expect(allowed).not.toContain('surgery_description');
    });

    it('get_documents só pode tokenizar protocol (sem nome de paciente)', () => {
      expect(TOOL_PII_ALLOWLIST.get_documents).toEqual(['protocol']);
    });
  });

  describe('isCategoryAllowedForTool', () => {
    it('retorna true para combinação válida', () => {
      expect(
        isCategoryAllowedForTool('get_surgery_request_status', 'patient_name'),
      ).toBe(true);
    });

    it('retorna false para combinação inválida', () => {
      expect(isCategoryAllowedForTool('get_documents', 'patient_name')).toBe(
        false,
      );
    });

    it('retorna false para tool desconhecida', () => {
      expect(isCategoryAllowedForTool('tool_inexistente', 'protocol')).toBe(
        false,
      );
    });
  });

  describe('getAllowedCategoriesForTool', () => {
    it('retorna lista vazia para tool não cadastrada', () => {
      expect(getAllowedCategoriesForTool('inexistente')).toEqual([]);
    });
  });

  describe('assertCategoryAllowed', () => {
    it('não lança quando categoria é permitida', () => {
      expect(() =>
        assertCategoryAllowed('get_surgery_request_status', 'protocol'),
      ).not.toThrow();
    });

    it('lança PiiAllowlistViolationError quando categoria é proibida', () => {
      expect(() =>
        assertCategoryAllowed('get_documents', 'patient_name'),
      ).toThrow(PiiAllowlistViolationError);
    });

    it('error inclui toolName e category', () => {
      try {
        assertCategoryAllowed('get_documents', 'cpf');
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(PiiAllowlistViolationError);
        expect((err as PiiAllowlistViolationError).toolName).toBe(
          'get_documents',
        );
        expect((err as PiiAllowlistViolationError).category).toBe('cpf');
      }
    });
  });
});
