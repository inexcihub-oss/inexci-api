import * as fs from 'fs';
import * as path from 'path';

const scripts = (
  JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
  ) as { scripts: Record<string, string> }
).scripts;

const QUE_FALAM_COM_O_BANCO = [
  'start',
  'start:dev',
  'start:debug',
  'start:prod',
  'typeorm',
  'typeorm:migration:generate',
  'typeorm:migration:create',
  'typeorm:migration:run',
  'typeorm:migration:revert',
  'seed',
  'seed:prices',
  'import:feegow',
  'test:e2e:prepare',
  'test:e2e',
  'test:e2e:fast',
  'test:e2e:changed',
  'test:e2e:watch',
  'test:e2e:cov',
  'check:pgvector',
  'migration:preflight',
];

describe('fuso dos scripts que falam com o banco', () => {
  it.each(QUE_FALAM_COM_O_BANCO)(
    '%s roda em UTC, o mesmo fuso do Postgres',
    (nome) => {
      expect(scripts[nome]).toMatch(/^TZ=UTC /);
    },
  );
});
