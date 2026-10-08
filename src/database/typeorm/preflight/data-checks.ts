import { maskPhone } from '../../../shared/utils/mask.util';

/**
 * Verificações de dado que precisam passar ANTES de uma migration restritiva
 * rodar. Existem porque `CREATE UNIQUE INDEX`, `ADD CONSTRAINT` e `SET NOT NULL`
 * quebram contra dado legado que já estava lá — e o erro do Postgres não diz
 * quais linhas colidem nem o que fazer. Foi o que derrubou o deploy de
 * 05/08/2026 (telefone repetido em `users`).
 *
 * Dois consumidores compartilham este registro:
 *  - a própria migration, que aborta antes de tentar o DDL;
 *  - `yarn migration:preflight`, que roda read-only contra produção antes de
 *    o deploy encostar na API.
 *
 * O SQL fica aqui, num lugar só: duplicá-lo faria o pré-flight aprovar um
 * deploy que a migration reprova. Entradas são **append-only** — uma migration
 * já aplicada em produção não pode ter sua checagem alterada retroativamente.
 */
export interface ConflitoDeDado {
  /** Identificador do conflito, com PII já mascarada (vai para log de deploy). */
  chave: string;
  /** Ids crus das linhas envolvidas — é o que o operador usa para agir. */
  ids: string;
}

export interface VerificacaoPreMigration {
  /** Nome da classe da migration que não pode rodar com o conflito de pé. */
  migration: string;
  descricao: string;
  /** SELECT read-only: cada linha devolvida é um conflito. */
  sql: string;
  /** O que o operador precisa fazer para destravar. */
  comoResolver: string;
  /**
   * Consulta para o operador inspecionar o caso. Sem ela, o diagnóstico sugere
   * a de `users` (a maioria das verificações aponta ids de usuário).
   */
  inspecionar?: string;
  mapear(linhas: Record<string, unknown>[]): ConflitoDeDado[];
}

export const TELEFONE_DUPLICADO: VerificacaoPreMigration = {
  migration: 'AddUniqueIndexUserPhone1752300900000',
  descricao: 'telefone repetido entre usuários vivos em "users"',
  sql: `SELECT u."phone" AS phone,
               string_agg(u."id"::text, ', ' ORDER BY u."created_at") AS ids
          FROM "users" u
         WHERE u."phone" IS NOT NULL AND u."deleted_at" IS NULL
         GROUP BY u."phone"
        HAVING count(*) > 1
         ORDER BY u."phone"`,
  comoResolver:
    'Escolha qual conta mantém o número e troque o telefone da(s) outra(s) — ou desative-a(s) — antes de repetir o deploy.',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: maskPhone(String(linha.phone ?? '')),
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * `FixUserDeletionReferentialActions` derruba e recria cinco chaves
 * estrangeiras. Recriar valida as linhas existentes: qualquer órfã — filho
 * apontando para um pai que não existe mais — aborta o `ADD CONSTRAINT` no
 * meio da migration, com um erro que não diz qual linha é.
 *
 * Órfã não deveria existir com a constraint antiga de pé, mas existe banco em
 * que ela foi derrubada à mão para destravar uma exclusão — que é exatamente a
 * dor que esta migration resolve.
 */
export const ORFAOS_ANTES_DA_CASCATA: VerificacaoPreMigration = {
  migration: 'FixUserDeletionReferentialActions1755700100000',
  descricao:
    'linha órfã nas relações que a migration recria (o pai referenciado não existe)',
  sql: `SELECT 'surgery_requests.created_by_id -> users' AS relacao,
               string_agg(sr."id"::text, ', ') AS ids
          FROM "surgery_requests" sr
          LEFT JOIN "users" u ON u."id" = sr."created_by_id"
         WHERE sr."created_by_id" IS NOT NULL AND u."id" IS NULL
        HAVING count(*) > 0
         UNION ALL
        SELECT 'surgery_requests.hospital_id -> hospitals',
               string_agg(sr."id"::text, ', ')
          FROM "surgery_requests" sr
          LEFT JOIN "hospitals" h ON h."id" = sr."hospital_id"
         WHERE sr."hospital_id" IS NOT NULL AND h."id" IS NULL
        HAVING count(*) > 0
         UNION ALL
        SELECT 'surgery_requests.health_plan_id -> health_plans',
               string_agg(sr."id"::text, ', ')
          FROM "surgery_requests" sr
          LEFT JOIN "health_plans" hp ON hp."id" = sr."health_plan_id"
         WHERE sr."health_plan_id" IS NOT NULL AND hp."id" IS NULL
        HAVING count(*) > 0
         UNION ALL
        SELECT 'patients.health_plan_id -> health_plans',
               string_agg(p."id"::text, ', ')
          FROM "patients" p
          LEFT JOIN "health_plans" hp ON hp."id" = p."health_plan_id"
         WHERE p."health_plan_id" IS NOT NULL AND hp."id" IS NULL
        HAVING count(*) > 0
         UNION ALL
        SELECT 'surgery_request_quotations.supplier_id -> suppliers',
               string_agg(q."id"::text, ', ')
          FROM "surgery_request_quotations" q
          LEFT JOIN "suppliers" s ON s."id" = q."supplier_id"
         WHERE q."supplier_id" IS NOT NULL AND s."id" IS NULL
        HAVING count(*) > 0`,
  comoResolver:
    'Aponte cada linha para um pai existente ou apague-a. As colunas nulas aceitam NULL, exceto surgery_requests.created_by_id — nesse caso a solicitação precisa de um usuário válido ou de ser removida.',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: String(linha.relacao ?? ''),
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * A unificação das linhas legadas chamadas "Outro"/"Outros" não é feita por
 * migration: ela é história do banco de produção. Essas linhas nasceram do
 * preenchimento automático dos slots de OPME, que mandava a string como se
 * fosse um nome digitado e fazia o backend criar um cadastro de verdade. Banco
 * novo nunca teve esse código escrevendo nele — não há o que fundir.
 *
 * Quem funde é `scripts/sql/outro-generico-aplicar.sql`, rodado uma vez à mão.
 * Esta verificação é o que impede a migration de completar o schema num banco
 * onde a fusão ainda não passou: `ensureGeneric` insere a linha genérica com o
 * nome "Outro", e em `manufacturers` o índice `uq_manufacturers_owner_name_active`
 * já protege `(owner_id, LOWER(name))` — a legada de mesmo nome derrubaria o
 * insert em runtime, num 500 que não diz o que aconteceu.
 *
 * `to_jsonb(...) ->> 'is_generic'` em vez de ler a coluna direto: a verificação
 * roda também ANTES de a coluna existir (banco que nunca recebeu nem o script
 * nem a migration), e ali um `WHERE "is_generic"` seria erro de coluna
 * inexistente. Ausente, o campo vem NULL e a linha conta como não unificada,
 * que é exatamente o que ela é.
 */
export const OUTRO_NAO_UNIFICADO: VerificacaoPreMigration = {
  migration: 'AddGenericSupplierAndManufacturer1755700200000',
  descricao:
    'fornecedor/fabricante legado chamado "Outro"/"Outros" ainda não unificado',
  sql: `SELECT 'supplier' AS tipo,
               s."name" AS nome,
               string_agg(s."id"::text, ', ' ORDER BY s."created_at") AS ids
          FROM "suppliers" s
         WHERE lower(btrim(s."name")) IN ('outro', 'outros')
           AND s."deleted_at" IS NULL
           AND COALESCE(to_jsonb(s) ->> 'is_generic', 'false') <> 'true'
         GROUP BY s."name"
         UNION ALL
        SELECT 'manufacturer' AS tipo,
               m."name" AS nome,
               string_agg(m."id"::text, ', ' ORDER BY m."created_at") AS ids
          FROM "manufacturers" m
         WHERE lower(btrim(m."name")) IN ('outro', 'outros')
           AND m."deleted_at" IS NULL
           AND COALESCE(to_jsonb(m) ->> 'is_generic', 'false') <> 'true'
         GROUP BY m."name"`,
  comoResolver:
    'Rode scripts/sql/outro-generico-aplicar.sql neste banco antes de repetir o deploy — ele funde as linhas numa só e marca a genérica. Confira antes com scripts/sql/outro-generico-conferencia.sql.',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: `${String(linha.tipo ?? '')}: ${String(linha.nome ?? '')}`,
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * `MakePatientCpfNullable` afrouxa o schema no `up` (CPF passa a ser opcional,
 * para receber pacientes migrados de outros sistemas sem CPF). Quem aperta é o
 * `down`: devolver o `NOT NULL` quebra assim que existir um paciente sem CPF.
 *
 * Por isso esta verificação **não** entra em `VERIFICACOES_PRE_MIGRATION`: o
 * pré-flight de deploy olha migrations pendentes indo para cima, e o `up` desta
 * não tem dado legado que o viole. Ela é usada só pelo `down`, para abortar com
 * a lista de pacientes em vez do erro cru do Postgres.
 */
export const PACIENTE_SEM_CPF: VerificacaoPreMigration = {
  migration: 'MakePatientCpfNullable1755800000000',
  descricao: 'paciente sem CPF em "patients" (impede reverter para NOT NULL)',
  sql: `SELECT p."owner_id" AS owner_id,
               string_agg(p."id"::text, ', ' ORDER BY p."created_at") AS ids
          FROM "patients" p
         WHERE p."cpf" IS NULL
         GROUP BY p."owner_id"
         ORDER BY p."owner_id"`,
  comoResolver:
    'Preencha o CPF desses pacientes (ou exclua-os definitivamente) antes de reverter a migration.',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: `conta ${String(linha.owner_id ?? '')}`,
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * `AddCouncilToDoctorProfiles` afrouxa `crm`/`crm_state` (profissional de
 * outro conselho pode não ter número cadastrado). Como em `PACIENTE_SEM_CPF`,
 * quem aperta é o `down`, então esta verificação fica fora de
 * `VERIFICACOES_PRE_MIGRATION` e só é usada por ele.
 */
export const PERFIL_SEM_REGISTRO: VerificacaoPreMigration = {
  migration: 'AddCouncilToDoctorProfiles1755800200000',
  descricao:
    'perfil profissional sem número ou UF do conselho em "doctor_profiles" (impede reverter para NOT NULL)',
  sql: `SELECT dp."council" AS council,
               string_agg(dp."user_id"::text, ', ' ORDER BY dp."created_at") AS ids
          FROM "doctor_profiles" dp
         WHERE dp."crm" IS NULL OR dp."crm_state" IS NULL
         GROUP BY dp."council"
         ORDER BY dp."council"`,
  comoResolver:
    'Preencha número e UF do conselho desses profissionais (ou remova o perfil) antes de reverter a migration.',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: `conselho ${String(linha.council ?? '')}`,
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * O `down` de `AddCouncilToDoctorProfiles` também derruba `council`. Antes
 * dela, ter `doctor_profiles` era ser médico: um psicólogo (CRP) ou
 * nutricionista (CRN) com número e UF passaria em `PERFIL_SEM_REGISTRO` e,
 * revertido, viraria médico — emitindo receita e atestado. Só o `down` usa.
 */
export const PERFIL_DE_OUTRO_CONSELHO: VerificacaoPreMigration = {
  migration: 'AddCouncilToDoctorProfiles1755800200000',
  descricao:
    'perfil profissional de conselho diferente de CRM em "doctor_profiles" (viraria médico ao reverter)',
  sql: `SELECT dp."council" AS council,
               string_agg(dp."user_id"::text, ', ' ORDER BY dp."created_at") AS ids
          FROM "doctor_profiles" dp
         WHERE dp."council" IS DISTINCT FROM 'CRM'
         GROUP BY dp."council"
         ORDER BY dp."council"`,
  comoResolver:
    'Remova o perfil profissional desses usuários (ou confirme que são médicos e troque o conselho para CRM) antes de reverter a migration.',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: `conselho ${String(linha.council ?? '')}`,
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * Status que ocupam a agenda, como literal SQL — congelado para a migration
 * `AddAppointmentsNoOverlapConstraint1755800900000`. Precisa bater com
 * `OCCUPYING_APPOINTMENT_STATUSES` (`appointment.entity.ts`); o spec da
 * migration garante. Mudou a lista? Migration nova recriando a constraint.
 */
export const STATUS_QUE_OCUPAM_A_AGENDA_SQL = `'scheduled', 'confirmed', 'waiting', 'in_progress', 'completed'`;

/**
 * `AddAppointmentsNoOverlapConstraint` cria uma exclusion constraint que
 * proíbe duas consultas do mesmo médico ocupando horários sobrepostos (fora
 * encaixe e excluídas). Dado legado sobreposto — criado na corrida do
 * check-then-insert ou importado — derrubaria o `ADD CONSTRAINT` sem dizer
 * quais consultas colidem.
 *
 * Mesmo predicado e mesmo `tsrange` da constraint (um `[)` vazio, de duração
 * zero, não sobrepõe nada — comparar início/fim na mão apontaria falso
 * conflito). O `GREATEST` evita que uma duração negativa derrube a própria
 * verificação; ela é listada à parte, porque o `tsrange` da constraint falha
 * com limite superior menor que o inferior.
 */
export const CONSULTAS_SOBREPOSTAS: VerificacaoPreMigration = {
  migration: 'AddAppointmentsNoOverlapConstraint1755800900000',
  descricao:
    'consultas do mesmo médico com horários sobrepostos (ou duração negativa) em "appointments"',
  sql: `SELECT 'médico ' || a."doctor_id"::text || ' em ' || a."scheduled_at"::text AS chave,
               a."id"::text || ', ' || b."id"::text AS ids
          FROM "appointments" a
          JOIN "appointments" b
            ON b."doctor_id" = a."doctor_id" AND b."id" > a."id"
         WHERE a."status" IN (${STATUS_QUE_OCUPAM_A_AGENDA_SQL})
           AND NOT a."is_walk_in" AND a."deleted_at" IS NULL
           AND b."status" IN (${STATUS_QUE_OCUPAM_A_AGENDA_SQL})
           AND NOT b."is_walk_in" AND b."deleted_at" IS NULL
           AND tsrange(timezone('UTC', a."scheduled_at"),
                       timezone('UTC', a."scheduled_at") + GREATEST(a."duration_minutes", 0) * interval '1 minute', '[)')
            && tsrange(timezone('UTC', b."scheduled_at"),
                       timezone('UTC', b."scheduled_at") + GREATEST(b."duration_minutes", 0) * interval '1 minute', '[)')
         UNION ALL
        SELECT 'duração negativa' AS chave,
               string_agg(n."id"::text, ', ') AS ids
          FROM "appointments" n
         WHERE n."duration_minutes" < 0
           AND n."status" IN (${STATUS_QUE_OCUPAM_A_AGENDA_SQL})
           AND NOT n."is_walk_in" AND n."deleted_at" IS NULL
        HAVING count(*) > 0`,
  comoResolver:
    'Para cada par, remarque, cancele ou marque como encaixe uma das consultas (ou corrija a duração negativa) antes de repetir o deploy. Inspecione com: SELECT id, doctor_id, patient_id, status, scheduled_at, duration_minutes FROM appointments WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: String(linha.chave ?? ''),
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * A mesma `AddAppointmentsNoOverlapConstraint` roda `CREATE EXTENSION IF NOT
 * EXISTS btree_gist`. Não é dado, é ambiente — mas o efeito no deploy é o
 * mesmo de um conflito de dado: banco sem o contrib, ou usuário da aplicação
 * sem permissão para criar a extensão, derruba a migration com um erro cru
 * (`could not open extension control file`, `permission denied to create
 * extension`) e a API fica fora do ar. Esta verificação adianta o problema
 * para o pré-flight e para o início da própria migration.
 *
 * Só reclama se a extensão ainda não existe no banco: já instalada, o `IF NOT
 * EXISTS` não faz nada e qualquer usuário passa. Ausente, ela precisa estar
 * disponível no servidor (`pg_available_extensions`) e o usuário precisa poder
 * criá-la: superusuário, ou extensão "trusted" (PG 13+) com privilégio de
 * criação no banco. Read-only — só consulta catálogo.
 */
export const EXTENSAO_BTREE_GIST: VerificacaoPreMigration = {
  migration: 'AddAppointmentsNoOverlapConstraint1755800900000',
  descricao:
    'extensão btree_gist ausente e impossível de criar com o usuário atual',
  // Diagnóstico por motivo, do mais básico ao mais fino. `CREATE EXTENSION`
  // por não-superusuário (PG 13+) exige as DUAS coisas: a extensão marcada
  // como `trusted` (btree_gist é, no contrib padrão — mas o pacote pode ter
  // sido alterado) e privilégio CREATE no banco atual (dono do banco tem por
  // padrão; um usuário de aplicação criado à parte, em geral, não). A versão
  // conferida é a `default_version`, que é a que o `CREATE EXTENSION` instala.
  sql: `SELECT x.motivo AS chave, 'btree_gist' AS ids
          FROM (
            SELECT CASE
                     WHEN e.name IS NULL
                       THEN 'btree_gist não está disponível no servidor (pacote contrib ausente)'
                     WHEN COALESCE((SELECT r.rolsuper FROM pg_roles r
                                     WHERE r.rolname = current_user), false)
                       THEN NULL
                     WHEN NOT COALESCE(v.trusted, false) AND COALESCE(v.superuser, true)
                       THEN 'btree_gist ' || COALESCE(e.default_version, '?')
                            || ' não é trusted neste servidor: só superusuário cria, e o usuário '
                            || current_user || ' não é superusuário'
                     WHEN NOT has_database_privilege(current_user, current_database(), 'CREATE')
                       THEN 'o usuário ' || current_user
                            || ' não tem privilégio CREATE no banco ' || current_database()
                            || ' (exigido para criar extensão trusted no PG 13+)'
                   END AS motivo
              FROM (SELECT 1) um
              LEFT JOIN pg_available_extensions e ON e.name = 'btree_gist'
              LEFT JOIN pg_available_extension_versions v
                     ON v.name = e.name AND v.version = e.default_version
             WHERE NOT EXISTS (
               SELECT 1 FROM pg_extension x2 WHERE x2.extname = 'btree_gist'
             )
          ) x
         WHERE x.motivo IS NOT NULL`,
  comoResolver:
    "Peça a um superusuário do Postgres para rodar `CREATE EXTENSION IF NOT EXISTS btree_gist;` neste banco (ou instale o pacote contrib, se ela não estiver disponível). Alternativa, quando o motivo for o privilégio: `GRANT CREATE ON DATABASE <banco> TO <usuário>;` (a extensão é trusted). Depois repita o deploy. Conferir com: SELECT * FROM pg_extension WHERE extname = 'btree_gist';",
  inspecionar:
    "SELECT current_user, current_database(), has_database_privilege(current_user, current_database(), 'CREATE') AS pode_criar, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario, (SELECT trusted FROM pg_available_extension_versions v JOIN pg_available_extensions e USING (name) WHERE name = 'btree_gist' AND v.version = e.default_version) AS trusted;",
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: String(linha.chave ?? ''),
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * `AddUniqueClinicRoomName` cria o índice único que fecha a corrida do
 * `assertNomeLivre` (`ClinicRoomsService`): mesmo nome, ignorando caixa e
 * espaços nas pontas, entre as salas não excluídas da mesma clínica. Sala
 * repetida gravada antes (corrida ou importação) derrubaria o índice sem dizer
 * qual. Mesmo predicado do índice.
 */
export const SALAS_COM_NOME_REPETIDO: VerificacaoPreMigration = {
  migration: 'AddUniqueClinicRoomName1755801000000',
  descricao:
    'salas da mesma clínica com o mesmo nome (sem diferenciar maiúsculas) em "clinic_rooms"',
  sql: `SELECT 'clínica ' || r."clinic_id"::text || ': ' || lower(btrim(r."name")) AS chave,
               string_agg(r."id"::text, ', ' ORDER BY r."created_at") AS ids
          FROM "clinic_rooms" r
         WHERE r."deleted_at" IS NULL
         GROUP BY r."clinic_id", lower(btrim(r."name"))
        HAVING count(*) > 1
         ORDER BY 1`,
  comoResolver:
    'Renomeie ou exclua as salas repetidas de cada clínica antes de repetir o deploy. Inspecione com: SELECT id, clinic_id, name, active FROM clinic_rooms WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: String(linha.chave ?? ''),
      ids: String(linha.ids ?? ''),
    })),
};

/**
 * `AddUniquePatientPhotoPath` cria um índice único parcial em
 * `patients.photo_path`: um objeto de foto no R2 pertence a um paciente só
 * (trocar a foto de um apaga o objeto, e o outro ficaria sem foto). Dado
 * legado com o mesmo caminho em dois pacientes — gravado na corrida do
 * `fotoEmUso`, que era check-then-write — derrubaria o `CREATE UNIQUE INDEX`.
 * Conta também os excluídos (soft delete), como o índice.
 */
export const FOTO_DE_PACIENTE_REPETIDA: VerificacaoPreMigration = {
  migration: 'AddUniquePatientPhotoPath1755801100000',
  descricao: 'mesma foto (photo_path) em mais de um paciente em "patients"',
  sql: `SELECT p."photo_path" AS photo_path,
               string_agg(p."id"::text, ', ' ORDER BY p."created_at") AS ids
          FROM "patients" p
         WHERE p."photo_path" IS NOT NULL
         GROUP BY p."photo_path"
        HAVING count(*) > 1
         ORDER BY p."photo_path"`,
  comoResolver:
    'Para cada caminho, mantenha a foto em um paciente e limpe o photo_path dos outros (UPDATE patients SET photo_path = NULL WHERE id IN (...)) antes de repetir o deploy. Inspecione com: SELECT id, owner_id, name, deleted_at FROM patients WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      // O caminho embute só ownerId + uuid + nome do arquivo: sem PII direta.
      chave: String(linha.photo_path ?? ''),
      ids: String(linha.ids ?? ''),
    })),
};

export const VERIFICACOES_PRE_MIGRATION: VerificacaoPreMigration[] = [
  TELEFONE_DUPLICADO,
  ORFAOS_ANTES_DA_CASCATA,
  OUTRO_NAO_UNIFICADO,
  CONSULTAS_SOBREPOSTAS,
  EXTENSAO_BTREE_GIST,
  SALAS_COM_NOME_REPETIDO,
  FOTO_DE_PACIENTE_REPETIDA,
];

/** Mensagem única, usada tanto no erro da migration quanto no pré-flight. */
export function montarDiagnostico(
  verificacao: VerificacaoPreMigration,
  conflitos: ConflitoDeDado[],
): string {
  return [
    `${verificacao.migration} bloqueada: ${conflitos.length} caso(s) de ${verificacao.descricao}.`,
    verificacao.comoResolver,
    'Conflitos (chave mascarada -> ids):',
    ...conflitos.map(({ chave, ids }) => `  ${chave} -> ${ids}`),
    `Para inspecionar: ${
      verificacao.inspecionar ??
      'SELECT id, email, role, status, created_at FROM users WHERE id IN (...);'
    }`,
  ].join('\n');
}

/**
 * Roda uma verificação e devolve os conflitos encontrados. `consultar` é
 * injetado porque os dois consumidores falam com o banco de formas diferentes:
 * a migration pelo `QueryRunner` do TypeORM, o pré-flight por um client `pg`.
 */
export async function verificar(
  verificacao: VerificacaoPreMigration,
  consultar: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<ConflitoDeDado[]> {
  const linhas = (await consultar(verificacao.sql)) ?? [];
  return verificacao.mapear(linhas);
}
