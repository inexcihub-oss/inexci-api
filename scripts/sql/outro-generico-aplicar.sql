-- =============================================================================
-- "Outro" genérico — APLICAR (escreve; roda uma vez, à mão)
-- =============================================================================
--
-- Unifica, por conta, as linhas legadas chamadas "Outro"/"Outros" numa única
-- linha marcada `is_generic`, e entrega o schema que a migration
-- `AddGenericSupplierAndManufacturer1755700200000` também entrega.
--
-- Por que à mão e não por migration: isto apaga linhas e não tem volta. Preso
-- ao start de um container, um erro no meio deixa a API reiniciando em loop com
-- o banco pela metade. Aqui você lê a conferência antes, roda com o deploy
-- parado e vê o resultado.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase (ou rode via psql) e
-- clique em Run — nada aqui depende de comando de cliente, é SQL puro:
--
--   1) rode outro-generico-conferencia.sql e leia o resultado
--   2) rode este arquivo
--
-- Reexecutável: rodar de novo não encontra mais nada para fundir e não muda
-- nada. Tudo numa transação — se abortar no meio (por exemplo pela trava
-- abaixo), o banco fica como estava; não precisa de `ROLLBACK` manual.
--
-- =============================================================================

BEGIN;

-- ── Trava: cadastro de verdade chamado "Outro" ───────────────────────────────
-- Essas linhas normalmente são cascas, criadas pelo preenchimento automático
-- dos slots de OPME. Se alguém preencheu cnpj, e-mail, telefone ou contato, é
-- um fornecedor real com nome infeliz — vira o genérico e perde a identidade.
-- Renomeie-o antes de rodar isto.
DO $$
DECLARE
  reais integer;
BEGIN
  SELECT count(*) INTO reais FROM (
    SELECT s."id"
      FROM "suppliers" s
     WHERE lower(btrim(s."name")) IN ('outro', 'outros')
       AND s."deleted_at" IS NULL
       AND (s."cnpj" IS NOT NULL OR s."email" IS NOT NULL
            OR s."phone" IS NOT NULL OR s."contact_name" IS NOT NULL)
     UNION ALL
    SELECT m."id"
      FROM "manufacturers" m
     WHERE lower(btrim(m."name")) IN ('outro', 'outros')
       AND m."deleted_at" IS NULL
       AND (m."cnpj" IS NOT NULL OR m."email" IS NOT NULL
            OR m."phone" IS NOT NULL OR m."contact_name" IS NOT NULL)
  ) t;

  IF reais > 0 THEN
    RAISE EXCEPTION
      'Abortado: % cadastro(s) com dados preenchidos chamado(s) "Outro"/"Outros". Rode outro-generico-conferencia.sql, renomeie-o(s) e tente de novo.',
      reais;
  END IF;
END $$;

-- ── Schema ───────────────────────────────────────────────────────────────────
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_generic" boolean NOT NULL DEFAULT false;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "is_generic" boolean NOT NULL DEFAULT false;

-- ── Fornecedores ─────────────────────────────────────────────────────────────

-- Elege a genérica de cada conta: viva antes de excluída, depois a mais antiga.
-- A ordem importa. Elegendo só pela idade, uma linha soft-deleted poderia
-- ganhar de uma viva de mesmo nome; ressuscitá-la deixaria as duas vivas e
-- `uq_manufacturers_owner_name_active` derrubaria o comando.
WITH eleitos AS (
  SELECT DISTINCT ON (s."owner_id") s."id"
    FROM "suppliers" s
   WHERE lower(btrim(s."name")) IN ('outro', 'outros')
   ORDER BY s."owner_id", (s."deleted_at" IS NOT NULL), s."created_at", s."id"
)
UPDATE "suppliers" s
   SET "is_generic" = true,
       "deleted_at" = NULL
  FROM eleitos e
 WHERE s."id" = e."id";

-- Remove a colisão antes de reapontar: a junção é única por (item, fornecedor),
-- então um item ligado à antiga E à genérica não aceita as duas linhas.
DELETE FROM "opme_item_suppliers" duplicada
 USING "suppliers" antiga, "suppliers" generica, "opme_item_suppliers" mantida
 WHERE duplicada."supplier_id" = antiga."id"
   AND antiga."is_generic" = false
   AND lower(btrim(antiga."name")) IN ('outro', 'outros')
   AND generica."owner_id" = antiga."owner_id"
   AND generica."is_generic" = true
   AND mantida."supplier_id" = generica."id"
   AND mantida."opme_item_id" = duplicada."opme_item_id";

UPDATE "opme_item_suppliers" j
   SET "supplier_id" = generica."id"
  FROM "suppliers" antiga, "suppliers" generica
 WHERE j."supplier_id" = antiga."id"
   AND antiga."is_generic" = false
   AND lower(btrim(antiga."name")) IN ('outro', 'outros')
   AND generica."owner_id" = antiga."owner_id"
   AND generica."is_generic" = true;

UPDATE "opme_items" oi
   SET "selected_supplier_id" = generica."id"
  FROM "suppliers" antiga, "suppliers" generica
 WHERE oi."selected_supplier_id" = antiga."id"
   AND antiga."is_generic" = false
   AND lower(btrim(antiga."name")) IN ('outro', 'outros')
   AND generica."owner_id" = antiga."owner_id"
   AND generica."is_generic" = true;

UPDATE "surgery_request_quotations" q
   SET "supplier_id" = generica."id"
  FROM "suppliers" antiga, "suppliers" generica
 WHERE q."supplier_id" = antiga."id"
   AND antiga."is_generic" = false
   AND lower(btrim(antiga."name")) IN ('outro', 'outros')
   AND generica."owner_id" = antiga."owner_id"
   AND generica."is_generic" = true;

-- Nada mais aponta para as antigas: as três chaves estrangeiras de "suppliers"
-- (junção, opme_items.selected_supplier_id e cotações) foram reapontadas acima.
DELETE FROM "suppliers"
 WHERE "is_generic" = false
   AND lower(btrim("name")) IN ('outro', 'outros');

-- Só agora o nome canônico: renomear antes de as perdedoras sumirem colidiria
-- com uma delas já chamada "Outro".
UPDATE "suppliers"
   SET "name" = 'Outro'
 WHERE "is_generic" = true
   AND "name" <> 'Outro';

-- ── Fabricantes ──────────────────────────────────────────────────────────────

WITH eleitos AS (
  SELECT DISTINCT ON (m."owner_id") m."id"
    FROM "manufacturers" m
   WHERE lower(btrim(m."name")) IN ('outro', 'outros')
   ORDER BY m."owner_id", (m."deleted_at" IS NOT NULL), m."created_at", m."id"
)
UPDATE "manufacturers" m
   SET "is_generic" = true,
       "deleted_at" = NULL
  FROM eleitos e
 WHERE m."id" = e."id";

DELETE FROM "opme_item_manufacturers" duplicada
 USING "manufacturers" antiga, "manufacturers" generica, "opme_item_manufacturers" mantida
 WHERE duplicada."manufacturer_id" = antiga."id"
   AND antiga."is_generic" = false
   AND lower(btrim(antiga."name")) IN ('outro', 'outros')
   AND generica."owner_id" = antiga."owner_id"
   AND generica."is_generic" = true
   AND mantida."manufacturer_id" = generica."id"
   AND mantida."opme_item_id" = duplicada."opme_item_id";

UPDATE "opme_item_manufacturers" j
   SET "manufacturer_id" = generica."id"
  FROM "manufacturers" antiga, "manufacturers" generica
 WHERE j."manufacturer_id" = antiga."id"
   AND antiga."is_generic" = false
   AND lower(btrim(antiga."name")) IN ('outro', 'outros')
   AND generica."owner_id" = antiga."owner_id"
   AND generica."is_generic" = true;

DELETE FROM "manufacturers"
 WHERE "is_generic" = false
   AND lower(btrim("name")) IN ('outro', 'outros');

UPDATE "manufacturers"
   SET "name" = 'Outro'
 WHERE "is_generic" = true
   AND "name" <> 'Outro';

-- ── Índices ──────────────────────────────────────────────────────────────────
-- Uma genérica por conta. Parcial por `deleted_at` para acompanhar o soft
-- delete, como em `uq_manufacturers_owner_name_active`.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_suppliers_owner_generic" ON "suppliers" ("owner_id") WHERE "is_generic" AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_manufacturers_owner_generic" ON "manufacturers" ("owner_id") WHERE "is_generic" AND "deleted_at" IS NULL;

-- ── Registro ─────────────────────────────────────────────────────────────────
-- Marca a migration como aplicada: o schema dela já está aqui, e sem isto o
-- próximo deploy a rodaria contra este banco. Ela é idempotente e sobreviveria,
-- mas o certo é a tabela dizer a verdade. `WHERE NOT EXISTS` porque este script
-- pode rodar de novo.
INSERT INTO "migrations" ("timestamp", "name")
SELECT 1755700200000, 'AddGenericSupplierAndManufacturer1755700200000'
 WHERE NOT EXISTS (
   SELECT 1 FROM "migrations"
    WHERE "name" = 'AddGenericSupplierAndManufacturer1755700200000'
 );

COMMIT;

-- ── Verificação ──────────────────────────────────────────────────────────────
-- Último statement do arquivo de propósito: em editores que só mostram o
-- resultado do último comando (caso do SQL Editor do Supabase), é isto que
-- aparece na tela ao terminar — a prova visual de que a genérica existe, uma
-- por conta, já com o nome canônico.
SELECT 'supplier' AS tipo, owner_id, id, name, is_generic
  FROM "suppliers" WHERE is_generic
 UNION ALL
SELECT 'manufacturer', owner_id, id, name, is_generic
  FROM "manufacturers" WHERE is_generic
 ORDER BY 1, 2;
