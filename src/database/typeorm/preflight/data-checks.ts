import { maskEmail, maskPhone } from '../../../shared/utils/mask.util';
import { telefoneCanonicoSql } from '../../../shared/utils/phone.util';

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (
    typeof valor === 'number' ||
    typeof valor === 'bigint' ||
    typeof valor === 'boolean'
  ) {
    return String(valor);
  }
  if (valor instanceof Date) return String(valor);
  return valor == null ? '' : JSON.stringify(valor);
}

export interface ConflitoDeDado {
  chave: string;
  ids: string;
}

export interface VerificacaoPreMigration {
  migration: string;
  descricao: string;
  sql: string;
  comoResolver: string;
  inspecionar?: string;
  sqlAntesDoSchema?: string;
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
      chave: maskPhone(texto(linha.phone)),
      ids: texto(linha.ids),
    })),
};

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
      chave: texto(linha.relacao),
      ids: texto(linha.ids),
    })),
};

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
      chave: `${texto(linha.tipo)}: ${texto(linha.nome)}`,
      ids: texto(linha.ids),
    })),
};

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
      chave: `conta ${texto(linha.owner_id)}`,
      ids: texto(linha.ids),
    })),
};

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
      chave: `conselho ${texto(linha.council)}`,
      ids: texto(linha.ids),
    })),
};

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
      chave: `conselho ${texto(linha.council)}`,
      ids: texto(linha.ids),
    })),
};

export const STATUS_QUE_OCUPAM_A_AGENDA_SQL = `'scheduled', 'confirmed', 'waiting', 'in_progress', 'completed'`;

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
  sqlAntesDoSchema: `SELECT 'médico ' || a."doctor_id"::text || ' em ' || a."scheduled_at"::text AS chave,
               a."id"::text || ', ' || b."id"::text AS ids
          FROM "appointments" a
          JOIN "appointments" b
            ON b."doctor_id" = a."doctor_id" AND b."id" > a."id"
         WHERE a."status" IN (${STATUS_QUE_OCUPAM_A_AGENDA_SQL})
           AND a."deleted_at" IS NULL
           AND b."status" IN (${STATUS_QUE_OCUPAM_A_AGENDA_SQL})
           AND b."deleted_at" IS NULL
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
           AND n."deleted_at" IS NULL
        HAVING count(*) > 0`,
  comoResolver:
    'Para cada par, remarque, cancele ou marque como encaixe uma das consultas (ou corrija a duração negativa) antes de repetir o deploy. Inspecione com: SELECT id, doctor_id, patient_id, status, scheduled_at, duration_minutes FROM appointments WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: texto(linha.chave),
      ids: texto(linha.ids),
    })),
};

export const EXTENSAO_BTREE_GIST: VerificacaoPreMigration = {
  migration: 'AddAppointmentsNoOverlapConstraint1755800900000',
  descricao:
    'extensão btree_gist ausente e impossível de criar com o usuário atual',
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
      chave: texto(linha.chave),
      ids: texto(linha.ids),
    })),
};

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
      chave: texto(linha.chave),
      ids: texto(linha.ids),
    })),
};

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
      chave: texto(linha.photo_path),
      ids: texto(linha.ids),
    })),
};

export const HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO: VerificacaoPreMigration = {
  migration: 'AddUniqueHospitalAndHealthPlanName1755801700000',
  descricao:
    'hospitais ou convênios vivos da mesma conta com o mesmo nome (sem diferenciar maiúsculas) em "hospitals"/"health_plans"',
  sql: `SELECT 'hospital' AS tipo,
               h."owner_id" AS owner_id,
               lower(h."name") AS nome,
               string_agg(h."id"::text, ', ' ORDER BY h."created_at") AS ids
          FROM "hospitals" h
         WHERE h."deleted_at" IS NULL
         GROUP BY h."owner_id", lower(h."name")
        HAVING count(*) > 1
         UNION ALL
        SELECT 'convênio' AS tipo,
               hp."owner_id" AS owner_id,
               lower(hp."name") AS nome,
               string_agg(hp."id"::text, ', ' ORDER BY hp."created_at") AS ids
          FROM "health_plans" hp
         WHERE hp."deleted_at" IS NULL
         GROUP BY hp."owner_id", lower(hp."name")
        HAVING count(*) > 1
         ORDER BY 1, 2, 3`,
  comoResolver:
    'Para cada grupo, escolha o registro que fica, aponte as solicitações cirúrgicas e os pacientes dos demais para ele (surgery_requests.hospital_id / health_plan_id, patients.health_plan_id) e exclua ou renomeie os outros antes de repetir o deploy.',
  inspecionar:
    'SELECT id, owner_id, name, active, created_at FROM hospitals WHERE id IN (...); SELECT id, owner_id, name, active, created_at FROM health_plans WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: `${texto(linha.tipo)} da conta ${texto(linha.owner_id)}: ${texto(linha.nome)}`,
      ids: texto(linha.ids),
    })),
};

export const TELEFONE_REPETIDO_APOS_CANONIZAR: VerificacaoPreMigration = {
  migration: 'CanonicalizeUserPhones1755802000000',
  descricao:
    'usuários vivos em "users" cujos telefones viram o mesmo número depois de canonizados (DDD + número, com o nono dígito)',
  sql: `SELECT c.canonico AS phone,
               string_agg(c.id::text, ', ' ORDER BY c.created_at) AS ids
          FROM (SELECT u."id" AS id,
                       u."created_at" AS created_at,
                       ${telefoneCanonicoSql('u."phone"')} AS canonico
                  FROM "users" u
                 WHERE u."phone" IS NOT NULL AND u."deleted_at" IS NULL) c
         WHERE c.canonico IS NOT NULL
         GROUP BY c.canonico
        HAVING count(*) > 1
         ORDER BY c.canonico`,
  comoResolver:
    'Os números abaixo pertencem a mais de uma conta quando escritos sem máscara, sem DDI 55 e com o nono dígito. Confirme com cada titular qual conta é a dona do número e troque o telefone (ou desative) as demais antes de repetir o deploy.',
  inspecionar:
    'SELECT id, email, role, status, owner_id, created_at FROM users WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: maskPhone(texto(linha.phone)),
      ids: texto(linha.ids),
    })),
};

export const EMAIL_REPETIDO_SEM_MAIUSCULAS: VerificacaoPreMigration = {
  migration: 'NormalizeUserEmailsLowercase1755802237000',
  descricao:
    'usuários em "users" (inclusive excluídos) cujos e-mails viram o mesmo endereço depois de btrim + lower',
  sql: `SELECT lower(btrim(u."email")) AS email,
               string_agg(u."id"::text, ', ' ORDER BY u."created_at") AS ids
          FROM "users" u
         GROUP BY lower(btrim(u."email"))
        HAVING count(*) > 1
         ORDER BY 1`,
  comoResolver:
    'Os endereços abaixo pertencem a mais de uma conta quando comparados sem diferenciar maiúsculas. Confirme com cada titular qual conta fica com o e-mail e troque o e-mail (ou exclua definitivamente) as demais antes de repetir o deploy.',
  inspecionar:
    'SELECT id, email, role, status, owner_id, created_at, deleted_at FROM users WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: maskEmail(texto(linha.email)),
      ids: texto(linha.ids),
    })),
};

export const TEXTO_RAPIDO_COM_ATALHO_REPETIDO: VerificacaoPreMigration = {
  migration: 'AddUniqueClinicalSnippetShortcut1761000700000',
  descricao:
    'textos rápidos vivos do mesmo médico com o mesmo atalho em "clinical_snippets"',
  sql: `SELECT cs."doctor_id" AS doctor_id,
               cs."shortcut" AS atalho,
               string_agg(cs."id"::text, ', ' ORDER BY cs."created_at") AS ids
          FROM "clinical_snippets" cs
         WHERE cs."deleted_at" IS NULL
         GROUP BY cs."doctor_id", cs."shortcut"
        HAVING count(*) > 1
         ORDER BY 1, 2`,
  comoResolver:
    'Para cada grupo, mantenha o texto rápido mais usado e troque o atalho dos demais (ou exclua-os pela tela de Configurações > Textos rápidos) antes de repetir o deploy.',
  inspecionar:
    'SELECT id, doctor_id, shortcut, title, usage_count, created_at FROM clinical_snippets WHERE id IN (...);',
  mapear: (linhas) =>
    linhas.map((linha) => ({
      chave: `médico ${texto(linha.doctor_id)}: /${texto(linha.atalho)}`,
      ids: texto(linha.ids),
    })),
};

function tabelasQueAMigrationCria(
  migration: string,
  tabelas: readonly string[],
): VerificacaoPreMigration {
  const lista = tabelas.map((tabela) => `'${tabela}'`).join(', ');
  return {
    migration,
    descricao: `tabela que a migration cria já existe no banco (${tabelas.join(', ')})`,
    sql: `SELECT t.nome AS tabela, t.nome AS ids
          FROM unnest(ARRAY[${lista}]::text[]) AS t(nome)
         WHERE to_regclass(format('public.%I', t.nome)) IS NOT NULL
         ORDER BY 1`,
    comoResolver:
      'A tabela existe sem a migration registrada (resto de execução manual ou parcial). Se estiver vazia, remova-a antes de repetir o deploy; se tiver dado, investigue a origem antes de qualquer ação.',
    inspecionar: 'SELECT count(*) FROM <tabela>;',
    mapear: (linhas) =>
      linhas.map((linha) => ({
        chave: texto(linha.tabela),
        ids: texto(linha.ids),
      })),
  };
}

export const TABELAS_DA_FUNDACAO_FINANCEIRA = tabelasQueAMigrationCria(
  'CreateFinancialAccountsAndPaymentMethodConfigs1760900000000',
  ['financial_accounts', 'payment_method_configs'],
);

export const TABELA_DE_CAIXA = tabelasQueAMigrationCria(
  'CreateCashSessions1760900100000',
  ['cash_sessions'],
);

export const TABELAS_DE_COBRANCA = tabelasQueAMigrationCria(
  'CreateReceivablesAndPayments1760900200000',
  [
    'receivables',
    'receivable_items',
    'payments',
    'refunds',
    'financial_entries',
    'payment_receipt_issues',
  ],
);

export const VERIFICACOES_PRE_MIGRATION: VerificacaoPreMigration[] = [
  TELEFONE_DUPLICADO,
  ORFAOS_ANTES_DA_CASCATA,
  OUTRO_NAO_UNIFICADO,
  CONSULTAS_SOBREPOSTAS,
  EXTENSAO_BTREE_GIST,
  SALAS_COM_NOME_REPETIDO,
  FOTO_DE_PACIENTE_REPETIDA,
  HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO,
  TELEFONE_REPETIDO_APOS_CANONIZAR,
  EMAIL_REPETIDO_SEM_MAIUSCULAS,
  TABELAS_DA_FUNDACAO_FINANCEIRA,
  TABELA_DE_CAIXA,
  TABELAS_DE_COBRANCA,
  TEXTO_RAPIDO_COM_ATALHO_REPETIDO,
];

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

export async function verificar(
  verificacao: VerificacaoPreMigration,
  consultar: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<ConflitoDeDado[]> {
  const linhas = (await consultar(verificacao.sql)) ?? [];
  return verificacao.mapear(linhas);
}
