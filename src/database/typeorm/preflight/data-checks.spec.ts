import {
  OUTRO_NAO_UNIFICADO,
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

  describe('OUTRO_NAO_UNIFICADO', () => {
    it('é read-only', () => {
      expect(OUTRO_NAO_UNIFICADO.sql).toMatch(/^\s*SELECT/i);
      expect(OUTRO_NAO_UNIFICADO.sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
      );
    });

    /**
     * A verificação roda também num banco que ainda não tem a coluna — é o
     * cenário principal dela, produção antes do script. Um `"is_generic"` cru
     * ali viraria erro de coluna inexistente, e o pré-flight é fail-closed:
     * falha ao consultar reprova o deploy. Todo banco novo travaria.
     */
    it('tolera a coluna is_generic ainda não existir', () => {
      expect(OUTRO_NAO_UNIFICADO.sql).toContain('to_jsonb');
      expect(OUTRO_NAO_UNIFICADO.sql).not.toContain('"is_generic"');
    });

    it('ignora a linha que já é a genérica', () => {
      expect(OUTRO_NAO_UNIFICADO.sql).toContain("'is_generic'");
      expect(OUTRO_NAO_UNIFICADO.sql).toContain("<> 'true'");
    });

    it('procura as duas grafias e só entre linhas vivas', () => {
      expect(OUTRO_NAO_UNIFICADO.sql).toContain("IN ('outro', 'outros')");
      expect(OUTRO_NAO_UNIFICADO.sql).toContain('deleted_at" IS NULL');
    });

    it('olha fornecedores e fabricantes', () => {
      expect(OUTRO_NAO_UNIFICADO.sql).toContain('"suppliers"');
      expect(OUTRO_NAO_UNIFICADO.sql).toContain('"manufacturers"');
    });

    it('manda rodar o script, que é quem unifica', () => {
      expect(OUTRO_NAO_UNIFICADO.comoResolver).toContain(
        'outro-generico-aplicar.sql',
      );
    });

    it('identifica o conflito por tipo e nome, preservando os ids', () => {
      const conflitos = OUTRO_NAO_UNIFICADO.mapear([
        { tipo: 'manufacturer', nome: 'Outros', ids: 'id-a, id-b' },
      ]);

      expect(conflitos).toEqual([
        { chave: 'manufacturer: Outros', ids: 'id-a, id-b' },
      ]);
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

    it('inclui a verificação do "Outro" não unificado', () => {
      expect(VERIFICACOES_PRE_MIGRATION).toContain(OUTRO_NAO_UNIFICADO);
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
