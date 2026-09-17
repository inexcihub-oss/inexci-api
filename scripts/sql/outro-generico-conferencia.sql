-- =============================================================================
-- "Outro" genérico — CONFERÊNCIA (não escreve nada)
-- =============================================================================
--
-- Rode este arquivo ANTES de `outro-generico-aplicar.sql` e leia a saída. Ele
-- responde três perguntas, nesta ordem:
--
--   1. Tem algum cadastro de VERDADE chamado "Outro"? Se tiver, o aplicar vai
--      abortar — e deve mesmo: transformá-lo no genérico apagaria um fornecedor
--      real. Renomeie-o para o nome certo e volte aqui.
--   2. Qual linha de cada conta vira a genérica?
--   3. Quantas linhas somem e quantas referências mudam de dono?
--
--   psql "$DATABASE_URL" -f scripts/sql/outro-generico-conferencia.sql
--
-- =============================================================================

\echo ''
\echo '== 1. Cadastros reais chamados "Outro" (precisa vir vazio) =================='

SELECT 'supplier' AS tipo, s."id", s."owner_id", s."name",
       s."cnpj", s."email", s."phone", s."contact_name"
  FROM "suppliers" s
 WHERE lower(btrim(s."name")) IN ('outro', 'outros')
   AND s."deleted_at" IS NULL
   AND (s."cnpj" IS NOT NULL OR s."email" IS NOT NULL
        OR s."phone" IS NOT NULL OR s."contact_name" IS NOT NULL)
 UNION ALL
SELECT 'manufacturer' AS tipo, m."id", m."owner_id", m."name",
       m."cnpj", m."email", m."phone", m."contact_name"
  FROM "manufacturers" m
 WHERE lower(btrim(m."name")) IN ('outro', 'outros')
   AND m."deleted_at" IS NULL
   AND (m."cnpj" IS NOT NULL OR m."email" IS NOT NULL
        OR m."phone" IS NOT NULL OR m."contact_name" IS NOT NULL)
 ORDER BY 1, 2;

\echo ''
\echo '== 2. Quem vira a genérica de cada conta ==================================='

-- Mesmo critério do aplicar: viva antes de excluída, depois a mais antiga.
SELECT 'supplier' AS tipo, eleita."owner_id", eleita."id" AS id_eleita,
       eleita."name" AS nome_atual, eleita."deleted_at" IS NOT NULL AS estava_excluida
  FROM (
    SELECT DISTINCT ON (s."owner_id") s.*
      FROM "suppliers" s
     WHERE lower(btrim(s."name")) IN ('outro', 'outros')
     ORDER BY s."owner_id", (s."deleted_at" IS NOT NULL), s."created_at", s."id"
  ) eleita
 UNION ALL
SELECT 'manufacturer' AS tipo, eleita."owner_id", eleita."id",
       eleita."name", eleita."deleted_at" IS NOT NULL
  FROM (
    SELECT DISTINCT ON (m."owner_id") m.*
      FROM "manufacturers" m
     WHERE lower(btrim(m."name")) IN ('outro', 'outros')
     ORDER BY m."owner_id", (m."deleted_at" IS NOT NULL), m."created_at", m."id"
  ) eleita
 ORDER BY 1, 2;

\echo ''
\echo '== 3. Volume: linhas que somem e referências que mudam de dono ============='

SELECT 'suppliers que somem' AS o_que,
       count(*) - count(DISTINCT s."owner_id") AS quantas
  FROM "suppliers" s
 WHERE lower(btrim(s."name")) IN ('outro', 'outros')
 UNION ALL
SELECT 'manufacturers que somem',
       count(*) - count(DISTINCT m."owner_id")
  FROM "manufacturers" m
 WHERE lower(btrim(m."name")) IN ('outro', 'outros')
 UNION ALL
SELECT 'vínculos opme_item_suppliers afetados', count(*)
  FROM "opme_item_suppliers" j
  JOIN "suppliers" s ON s."id" = j."supplier_id"
 WHERE lower(btrim(s."name")) IN ('outro', 'outros')
 UNION ALL
SELECT 'vínculos opme_item_manufacturers afetados', count(*)
  FROM "opme_item_manufacturers" j
  JOIN "manufacturers" m ON m."id" = j."manufacturer_id"
 WHERE lower(btrim(m."name")) IN ('outro', 'outros')
 UNION ALL
SELECT 'opme_items.selected_supplier_id afetados', count(*)
  FROM "opme_items" oi
  JOIN "suppliers" s ON s."id" = oi."selected_supplier_id"
 WHERE lower(btrim(s."name")) IN ('outro', 'outros')
 UNION ALL
SELECT 'cotações afetadas', count(*)
  FROM "surgery_request_quotations" q
  JOIN "suppliers" s ON s."id" = q."supplier_id"
 WHERE lower(btrim(s."name")) IN ('outro', 'outros');

\echo ''
