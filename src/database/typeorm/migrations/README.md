# Database Migrations

Diretório de migrations TypeORM para gerenciar o schema do banco de dados.

## Comandos

```bash
# Executar migrations
npm run typeorm:migration:run

# Reverter última migration
npm run typeorm:migration:revert

# Gerar migration baseada nas entities
npm run typeorm:migration:generate -- src/database/typeorm/migrations/NomeDaMigration

# Criar migration vazia
npm run typeorm:migration:create -- src/database/typeorm/migrations/NomeDaMigration
```
