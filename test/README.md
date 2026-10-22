# Testes E2E - Inexci API

Testes end-to-end (e2e) para todas as rotas da API.

## 🧪 Como Executar

```bash
# Todos os testes e2e
npm run test:e2e

# Teste específico
npm run test:e2e -- auth.e2e-spec.ts

# Com watch mode
npm run test:e2e -- --watch

# Com cobertura
npm run test:e2e -- --coverage
```

## 📁 Estrutura

```
test/
├── e2e/                # Testes por módulo
│   ├── auth.e2e-spec.ts
│   ├── users.e2e-spec.ts
│   ├── patients.e2e-spec.ts
│   └── ...
├── helpers/            # Utilitários de teste
└── fixtures/           # Arquivos de teste
```

## 📦 Módulos Testados

- ✅ Auth (login, registro, autenticação)
- ✅ Users (CRUD de usuários)
- ✅ Patients (CRUD de pacientes)
- ✅ Hospitals (CRUD de hospitais)
- ✅ Procedures (CRUD de procedimentos)
- ✅ Surgery Requests (solicitações cirúrgicas)
- ✅ Quotations (cotações)
- ✅ Documents (documentos)
- ✅ Chats (mensagens)
- ✅ Pendencies (pendências)
- ✅ Reports (relatórios)
