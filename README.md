# INEXCI API

Backend da aplicação INEXCI desenvolvido em NestJS com TypeORM e PostgreSQL.

## 🚀 Como Rodar

### Com Docker (Recomendado)

```bash
# Na raiz do projeto (inexci-app/)
docker-compose up -d

# Ver logs da API
docker-compose logs -f api
```

### Sem Docker

```bash
# Instalar dependências
npm install

# Configurar .env (veja .env.example)
cp .env.example .env

# Executar migrations
npm run typeorm:migration:run

# Popular banco (seed)
npm run seed

# Iniciar em modo desenvolvimento
npm run start:dev
```

## 📦 Comandos Úteis

```bash
# Desenvolvimento
npm run start:dev       # Iniciar com hot reload
npm run start:prod      # Iniciar em produção

# Migrations
npm run typeorm:migration:run      # Executar migrations
npm run typeorm:migration:revert   # Reverter última migration
npm run typeorm:migration:generate # Gerar migration

# Seed
npm run seed           # Popular banco de dados

# Testes
npm run test           # Testes unitários
npm run test:e2e       # Testes e2e
npm run test:cov       # Cobertura de testes
```

## 🛠️ Tecnologias

- **NestJS** - Framework Node.js
- **TypeORM** - ORM para PostgreSQL
- **PostgreSQL** - Banco de dados
- **JWT** - Autenticação
- **Passport** - Estratégias de autenticação

## 🧠 RAG / pgvector

A IA do WhatsApp depende da tabela `ai_knowledge_chunk` com coluna
`embedding vector(1536)` indexada por IVFFlat. Para isso o Postgres precisa
ter a extensão `pgvector` disponível.

**Imagem recomendada (Docker):** `pgvector/pgvector:pg16`

### Verificação rápida

```sql
-- Extensão disponível na imagem?
SELECT 1 FROM pg_available_extensions WHERE name = 'vector';

-- Extensão instalada no banco?
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Pré-deploy automatizado

```bash
yarn check:pgvector   # valida disponibilidade da extensão
yarn predeploy        # roda check:pgvector como passo de gate
```

### Troubleshooting

- **Migration `InitialSchema...` falha com "Extensão pgvector indisponível":**
  o Postgres em uso não tem a extensão. Use a imagem
  `pgvector/pgvector:pg16` ou instale o pacote `postgresql-16-pgvector`
  e reinicie o serviço.
- **`RagBootstrapService` loga "Schema RAG não está pronto":** a migration
  `CreateAiKnowledgeChunkVector` ainda não foi aplicada. Rode
  `yarn typeorm:migration:run`.
- **Embeddings não retornam resultado:** confirme que a coluna `embedding`
  da tabela `ai_knowledge_chunk` é `vector(1536)` (a versão antiga era
  `text` em ambientes degradados). Em ambientes legados, basta rodar a
  migration nova; ela converte e reindexa.

## 📋 Checklist de deploy

1. Backup do Postgres antes de qualquer migration que toque
   `ai_knowledge_chunk`, `embedding` ou a extensão `vector`.
2. Validar a imagem do banco em homologação antes de subir produção
   (`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`).
3. Rodar `yarn typeorm:migration:show` e revisar pendentes antes do deploy.
4. Rodar `yarn check:pgvector` (já encadeado em `yarn predeploy`).
5. Aplicar migrations (`yarn typeorm:migration:run`).
6. Confirmar nos logs do bootstrap:
   `RAG seedado automaticamente a partir do arquivo estruturado.`

## 🔄 Política de manutenção da base RAG

A base `ai_knowledge_chunk` é alimentada **automaticamente** a partir de
`docs/rag-knowledge-structured.json` na primeira inicialização do app
(quando a tabela está vazia). Atualizações posteriores do JSON **não** são
aplicadas em runtime — para forçar reseed:

1. Backup das linhas atuais (`pg_dump` filtrando a tabela);
2. `TRUNCATE ai_knowledge_chunk` em janela controlada;
3. Reinicialização da API (o bootstrap detecta base vazia e re-seeda).

Em produção, a recomendação é versionar o JSON e tratar mudanças como
parte do deploy (não há export/import periódico automático).
