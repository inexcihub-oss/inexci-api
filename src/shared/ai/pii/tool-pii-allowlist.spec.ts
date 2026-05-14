import {
  TOOL_PII_ALLOWLIST,
  assertCategoryAllowed,
  getAllowedCategoriesForTool,
  isCategoryAllowedForTool,
  PiiAllowlistViolationError,
} from './tool-pii-allowlist';

describe('tool-pii-allowlist', () => {
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

    // Regressão Sub-fase 3.8: tools legacy de update removidas — nenhuma allowlist.
    it('update_request_clinical_data, update_request_admin_data, update_patient_data e update_surgery_request_data não têm entrada na allowlist', () => {
      expect(
        TOOL_PII_ALLOWLIST['update_request_clinical_data'],
      ).toBeUndefined();
      expect(TOOL_PII_ALLOWLIST['update_request_admin_data']).toBeUndefined();
      expect(TOOL_PII_ALLOWLIST['update_patient_data']).toBeUndefined();
      expect(TOOL_PII_ALLOWLIST['update_surgery_request_data']).toBeUndefined();
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

    it('search_tuss_codes não tokeniza nada (catálogo público)', () => {
      expect(TOOL_PII_ALLOWLIST.search_tuss_codes).toEqual([]);
    });

    it('search_cid_codes não tokeniza nada (catálogo público)', () => {
      expect(TOOL_PII_ALLOWLIST.search_cid_codes).toEqual([]);
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

  describe('getAllowedCategoriesForTool', () => {
    it('retorna lista vazia para tool não cadastrada', () => {
      expect(getAllowedCategoriesForTool('inexistente')).toEqual([]);
    });
  });

  describe('assertCategoryAllowed', () => {
    it('não lança quando categoria é permitida', () => {
      expect(() =>
        assertCategoryAllowed('query_surgery_requests', 'protocol'),
      ).not.toThrow();
    });

    it('lança PiiAllowlistViolationError quando categoria é proibida', () => {
      expect(() =>
        assertCategoryAllowed('manage_documents', 'patient_name'),
      ).toThrow(PiiAllowlistViolationError);
    });

    it('error inclui toolName e category', () => {
      try {
        assertCategoryAllowed('manage_documents', 'cpf');
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
