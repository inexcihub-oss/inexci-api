import {
  TELEFONE_DUPLICADO,
  VERIFICACOES_PRE_MIGRATION,
  montarDiagnostico,
} from './data-checks';

/**
 * As verificações vivem fora de `migrations/` (o glob do `data-source.ts`
 * carrega aquela pasta inteira) e são compartilhadas por dois consumidores: a
 * própria migration, que aborta antes de tentar o DDL, e o `migration:preflight`,
 * que roda read-only contra produção antes do deploy. Duplicar o SQL entre os
 * dois faria o pré-flight aprovar um deploy que a migration reprova.
 */
describe('verificações pré-migration', () => {
  describe('TELEFONE_DUPLICADO', () => {
    it('só considera usuários vivos e com telefone', () => {
      expect(TELEFONE_DUPLICADO.sql).toContain('deleted_at" IS NULL');
      expect(TELEFONE_DUPLICADO.sql).toContain('phone" IS NOT NULL');
      expect(TELEFONE_DUPLICADO.sql).toContain('HAVING count(*) > 1');
    });

    it('é read-only', () => {
      expect(TELEFONE_DUPLICADO.sql).toMatch(/^\s*SELECT/i);
      expect(TELEFONE_DUPLICADO.sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
      );
    });

    it('mascara o telefone e preserva os ids ao mapear', () => {
      const conflitos = TELEFONE_DUPLICADO.mapear([
        { phone: '21995953689', ids: 'id-a, id-b' },
      ]);

      expect(conflitos).toHaveLength(1);
      expect(conflitos[0].ids).toBe('id-a, id-b');
      expect(conflitos[0].chave).not.toContain('21995953689');
      expect(conflitos[0].chave).toContain('3689');
    });
  });

  describe('registro', () => {
    it('aponta cada verificação para uma migration distinta', () => {
      const migrations = VERIFICACOES_PRE_MIGRATION.map((v) => v.migration);

      expect(migrations.length).toBeGreaterThan(0);
      expect(new Set(migrations).size).toBe(migrations.length);
    });

    it('inclui a verificação de telefone duplicado', () => {
      expect(VERIFICACOES_PRE_MIGRATION).toContain(TELEFONE_DUPLICADO);
    });
  });

  describe('montarDiagnostico', () => {
    const conflitos = [
      { chave: '*******3689', ids: 'id-a, id-b' },
      { chave: '*******7777', ids: 'id-c, id-d' },
    ];

    it('nomeia a migration, lista todos os conflitos e diz como resolver', () => {
      const texto = montarDiagnostico(TELEFONE_DUPLICADO, conflitos);

      expect(texto).toContain(TELEFONE_DUPLICADO.migration);
      expect(texto).toContain('id-a, id-b');
      expect(texto).toContain('id-c, id-d');
      expect(texto).toContain(TELEFONE_DUPLICADO.comoResolver);
    });
  });
});
