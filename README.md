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
