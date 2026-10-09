import {
  CONSULTAS_SOBREPOSTAS,
  EXTENSAO_BTREE_GIST,
  OUTRO_NAO_UNIFICADO,
  SALAS_COM_NOME_REPETIDO,
  TELEFONE_DUPLICADO,
  VERIFICACOES_PRE_MIGRATION,
  montarDiagnostico,
} from './data-checks';

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

  describe('EXTENSAO_BTREE_GIST', () => {
    it('é da migration que roda CREATE EXTENSION btree_gist', () => {
      expect(EXTENSAO_BTREE_GIST.migration).toBe(
        'AddAppointmentsNoOverlapConstraint1755800900000',
      );
    });

    it('é read-only (só consulta catálogo)', () => {
      expect(EXTENSAO_BTREE_GIST.sql).toMatch(/^\s*SELECT/i);
      expect(EXTENSAO_BTREE_GIST.sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b|CREATE\s+EXTENSION/i,
      );
    });

    it('só reclama se a extensão ainda não existe, e confere disponibilidade e permissão', () => {
      expect(EXTENSAO_BTREE_GIST.sql).toContain('pg_extension');
      expect(EXTENSAO_BTREE_GIST.sql).toContain('pg_available_extensions');
      expect(EXTENSAO_BTREE_GIST.sql).toContain('rolsuper');
      expect(EXTENSAO_BTREE_GIST.sql).toContain('trusted');
      expect(EXTENSAO_BTREE_GIST.sql).toContain('has_database_privilege');
    });

    it('diz como destravar', () => {
      expect(EXTENSAO_BTREE_GIST.comoResolver).toContain(
        'CREATE EXTENSION IF NOT EXISTS btree_gist',
      );
      expect(EXTENSAO_BTREE_GIST.comoResolver).toContain(
        'GRANT CREATE ON DATABASE',
      );
    });

    it('confere o privilégio CREATE no banco atual, do usuário atual', () => {
      expect(EXTENSAO_BTREE_GIST.sql).toContain(
        "has_database_privilege(current_user, current_database(), 'CREATE')",
      );
    });

    it('superusuário passa sem olhar trusted nem privilégio', () => {
      const sql = EXTENSAO_BTREE_GIST.sql;
      expect(sql.indexOf('rolsuper')).toBeLessThan(sql.indexOf('trusted'));
      expect(sql.indexOf('rolsuper')).toBeLessThan(
        sql.indexOf('has_database_privilege'),
      );
    });

    it('confere o trusted da versão que o CREATE EXTENSION instala', () => {
      expect(EXTENSAO_BTREE_GIST.sql).toContain(
        'v.version = e.default_version',
      );
    });

    it('cada motivo vira um diagnóstico distinto, com usuário e banco', () => {
      const sql = EXTENSAO_BTREE_GIST.sql;
      expect(sql).toContain('pacote contrib ausente');
      expect(sql).toContain('não é trusted neste servidor');
      expect(sql).toContain('não tem privilégio CREATE no banco');
      expect(sql).toContain('current_database()');
    });

    it('diagnóstico sugere a consulta de privilégios, não a de users', () => {
      const texto = montarDiagnostico(EXTENSAO_BTREE_GIST, [
        {
          chave:
            'o usuário inexci não tem privilégio CREATE no banco inexci (exigido para criar extensão trusted no PG 13+)',
          ids: 'btree_gist',
        },
      ]);

      expect(texto).toContain('não tem privilégio CREATE no banco inexci');
      expect(texto).toContain('has_database_privilege');
      expect(texto).not.toContain('FROM users WHERE id IN');
    });
  });

  describe('SALAS_COM_NOME_REPETIDO', () => {
    it('usa o mesmo predicado do índice (clínica + nome sem caixa, vivas)', () => {
      expect(SALAS_COM_NOME_REPETIDO.sql).toContain('lower(btrim(r."name"))');
      expect(SALAS_COM_NOME_REPETIDO.sql).toContain('deleted_at" IS NULL');
      expect(SALAS_COM_NOME_REPETIDO.sql).toContain('HAVING count(*) > 1');
    });

    it('é read-only', () => {
      expect(SALAS_COM_NOME_REPETIDO.sql).toMatch(/^\s*SELECT/i);
      expect(SALAS_COM_NOME_REPETIDO.sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
      );
    });
  });

  describe('registro', () => {
    it('não repete verificação (migration + descrição)', () => {
      const chaves = VERIFICACOES_PRE_MIGRATION.map(
        (v) => `${v.migration} :: ${v.descricao}`,
      );

      expect(chaves.length).toBeGreaterThan(0);
      expect(new Set(chaves).size).toBe(chaves.length);
    });

    it('inclui a extensão btree_gist e as salas repetidas', () => {
      expect(VERIFICACOES_PRE_MIGRATION).toContain(EXTENSAO_BTREE_GIST);
      expect(VERIFICACOES_PRE_MIGRATION).toContain(SALAS_COM_NOME_REPETIDO);
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
      expect(texto).toContain('FROM users WHERE id IN');
    });
  });
});

describe('CONSULTAS_SOBREPOSTAS.sqlAntesDoSchema', () => {
  it('é a mesma checagem sem o filtro de encaixe (coluna que ainda não existe)', () => {
    const semEncaixe = (sql: string) =>
      sql.replace(/\s*AND NOT [abn]\."is_walk_in"/g, '').replace(/\s+/g, ' ');

    expect(CONSULTAS_SOBREPOSTAS.sqlAntesDoSchema!).not.toContain('is_walk_in');
    expect(semEncaixe(CONSULTAS_SOBREPOSTAS.sqlAntesDoSchema!)).toBe(
      semEncaixe(CONSULTAS_SOBREPOSTAS.sql),
    );
  });
});
