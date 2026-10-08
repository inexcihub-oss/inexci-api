-- =============================================================================
-- "Outro" genérico — CONFERÊNCIA (não escreve nada)
-- =============================================================================
--
-- Cole este arquivo inteiro no SQL Editor do Supabase (ou rode via psql) e
-- clique em Run. É um SELECT único — dá pra copiar e colar sem adaptar nada,
-- e o resultado sai todo numa tabela só, mesmo em editores que só mostram o
-- resultado do último statement.
--
-- Rode ANTES de `outro-generico-aplicar.sql` e leia a coluna "detalhe" de
-- cada seção, nesta ordem:
--
--   1. Tem algum cadastro de VERDADE chamado "Outro"? Precisa vir vazio (só a
--      linha "OK"). Se aparecer alguma linha "supplier"/"manufacturer" aqui,
--      o aplicar vai abortar — e deve mesmo: transformá-lo no genérico
--      apagaria um fornecedor real. Renomeie-o para o nome certo e rode de
--      novo esta conferência.
--   2. Qual linha de cada conta vira a genérica.
--   3. Quantas linhas somem e quantas referências mudam de dono.
--
-- =============================================================================

SELECT secao, o_que, detalhe
  FROM (
    -- ── 1. Cadastros reais chamados "Outro" (precisa vir vazio) ────────────
    SELECT
      1 AS secao,
      '1. Cadastro real chamado "Outro"' AS o_que,
      jsonb_build_object(
        'tipo', 'supplier', 'id', s."id", 'owner_id', s."owner_id",
        'name', s."name", 'cnpj', s."cnpj", 'email', s."email",
        'phone', s."phone", 'contact_name', s."contact_name"
      ) AS detalhe
      FROM "suppliers" s
     WHERE lower(btrim(s."name")) IN ('outro', 'outros')
       AND s."deleted_at" IS NULL
       AND (s."cnpj" IS NOT NULL OR s."email" IS NOT NULL
            OR s."phone" IS NOT NULL OR s."contact_name" IS NOT NULL)

    UNION ALL

    SELECT
      1, '1. Cadastro real chamado "Outro"',
      jsonb_build_object(
        'tipo', 'manufacturer', 'id', m."id", 'owner_id', m."owner_id",
        'name', m."name", 'cnpj', m."cnpj", 'email', m."email",
        'phone', m."phone", 'contact_name', m."contact_name"
      )
      FROM "manufacturers" m
     WHERE lower(btrim(m."name")) IN ('outro', 'outros')
       AND m."deleted_at" IS NULL
       AND (m."cnpj" IS NOT NULL OR m."email" IS NOT NULL
            OR m."phone" IS NOT NULL OR m."contact_name" IS NOT NULL)

    UNION ALL

    -- Sem violação nenhuma, mostra "OK" em vez de a seção ficar vazia e
    -- alguém confundir "vazio porque passou" com "vazio porque a query quebrou".
    SELECT 1, '1. Cadastro real chamado "Outro"', jsonb_build_object('status', 'OK — nenhum encontrado')
     WHERE NOT EXISTS (
             SELECT 1 FROM "suppliers" s
              WHERE lower(btrim(s."name")) IN ('outro', 'outros')
                AND s."deleted_at" IS NULL
                AND (s."cnpj" IS NOT NULL OR s."email" IS NOT NULL
                     OR s."phone" IS NOT NULL OR s."contact_name" IS NOT NULL)
           )
       AND NOT EXISTS (
             SELECT 1 FROM "manufacturers" m
              WHERE lower(btrim(m."name")) IN ('outro', 'outros')
                AND m."deleted_at" IS NULL
                AND (m."cnpj" IS NOT NULL OR m."email" IS NOT NULL
                     OR m."phone" IS NOT NULL OR m."contact_name" IS NOT NULL)
           )

    UNION ALL

    -- ── 2. Quem vira a genérica de cada conta ───────────────────────────────
    -- Mesmo critério do aplicar: viva antes de excluída, depois a mais antiga.
    SELECT
      2, '2. Vira a genérica da conta',
      jsonb_build_object(
        'tipo', 'supplier', 'owner_id', eleita."owner_id",
        'id_eleita', eleita."id", 'nome_atual', eleita."name",
        'estava_excluida', eleita."deleted_at" IS NOT NULL
      )
      FROM (
        SELECT DISTINCT ON (s."owner_id") s.*
          FROM "suppliers" s
         WHERE lower(btrim(s."name")) IN ('outro', 'outros')
         ORDER BY s."owner_id", (s."deleted_at" IS NOT NULL), s."created_at", s."id"
      ) eleita

    UNION ALL

    SELECT
      2, '2. Vira a genérica da conta',
      jsonb_build_object(
        'tipo', 'manufacturer', 'owner_id', eleita."owner_id",
        'id_eleita', eleita."id", 'nome_atual', eleita."name",
        'estava_excluida', eleita."deleted_at" IS NOT NULL
      )
      FROM (
        SELECT DISTINCT ON (m."owner_id") m.*
          FROM "manufacturers" m
         WHERE lower(btrim(m."name")) IN ('outro', 'outros')
         ORDER BY m."owner_id", (m."deleted_at" IS NOT NULL), m."created_at", m."id"
      ) eleita

    UNION ALL

    -- ── 3. Volume: linhas que somem e referências que mudam de dono ────────
    SELECT 3, '3. Volume',
      jsonb_build_object(
        'o_que', 'suppliers que somem',
        'quantas', count(*) - count(DISTINCT s."owner_id")
      )
      FROM "suppliers" s
     WHERE lower(btrim(s."name")) IN ('outro', 'outros')

    UNION ALL

    SELECT 3, '3. Volume',
      jsonb_build_object(
        'o_que', 'manufacturers que somem',
        'quantas', count(*) - count(DISTINCT m."owner_id")
      )
      FROM "manufacturers" m
     WHERE lower(btrim(m."name")) IN ('outro', 'outros')

    UNION ALL

    SELECT 3, '3. Volume',
      jsonb_build_object('o_que', 'vínculos opme_item_suppliers afetados', 'quantas', count(*))
      FROM "opme_item_suppliers" j
      JOIN "suppliers" s ON s."id" = j."supplier_id"
     WHERE lower(btrim(s."name")) IN ('outro', 'outros')

    UNION ALL

    SELECT 3, '3. Volume',
      jsonb_build_object('o_que', 'vínculos opme_item_manufacturers afetados', 'quantas', count(*))
      FROM "opme_item_manufacturers" j
      JOIN "manufacturers" m ON m."id" = j."manufacturer_id"
     WHERE lower(btrim(m."name")) IN ('outro', 'outros')

    UNION ALL

    SELECT 3, '3. Volume',
      jsonb_build_object('o_que', 'opme_items.selected_supplier_id afetados', 'quantas', count(*))
      FROM "opme_items" oi
      JOIN "suppliers" s ON s."id" = oi."selected_supplier_id"
     WHERE lower(btrim(s."name")) IN ('outro', 'outros')

    UNION ALL

    SELECT 3, '3. Volume',
      jsonb_build_object('o_que', 'cotações afetadas', 'quantas', count(*))
      FROM "surgery_request_quotations" q
      JOIN "suppliers" s ON s."id" = q."supplier_id"
     WHERE lower(btrim(s."name")) IN ('outro', 'outros')
  ) resultado
 ORDER BY secao, o_que;
