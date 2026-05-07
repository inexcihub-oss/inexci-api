/**
 * CLI para atualizar a versão de um consentimento em consent.config.ts.
 *
 * Uso:
 *   npx ts-node src/cli/bump-consent-version.ts <type> <new_version>
 *
 * Exemplos:
 *   npx ts-node src/cli/bump-consent-version.ts ai 2.0
 *   npx ts-node src/cli/bump-consent-version.ts privacy_policy 1.1
 *
 * Notas:
 * - Bumps de MAJOR (ex: 1.x → 2.0) forçam reaceite dos usuários no próximo login.
 * - Bumps de MINOR (ex: 1.0 → 1.1) são cosméticos e não disparam reaceite.
 */

import * as fs from 'fs';
import * as path from 'path';

const VALID_TYPES = ['privacy_policy', 'terms_of_use', 'ai'];
const CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'consent.config.ts',
);

function main(): void {
  const [, , type, newVersion] = process.argv;

  if (!type || !newVersion) {
    console.error(
      'Uso: npx ts-node src/cli/bump-consent-version.ts <type> <new_version>',
    );
    console.error(`  Tipos válidos: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  if (!VALID_TYPES.includes(type)) {
    console.error(`Tipo inválido: "${type}". Use: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  if (!/^\d+\.\d+$/.test(newVersion)) {
    console.error(
      `Versão inválida: "${newVersion}". Use formato MAJOR.MINOR (ex: 2.0)`,
    );
    process.exit(1);
  }

  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const regex = new RegExp(`(${type}:\\s*')([\\d.]+)(')`);
  const match = content.match(regex);

  if (!match) {
    console.error(
      `Não foi possível encontrar a versão de "${type}" no config.`,
    );
    process.exit(1);
  }

  const oldVersion = match[2];
  if (oldVersion === newVersion) {
    console.log(`Versão de "${type}" já é ${newVersion}. Nada a fazer.`);
    return;
  }

  const updated = content.replace(regex, `$1${newVersion}$3`);
  fs.writeFileSync(CONFIG_PATH, updated, 'utf-8');

  const oldMajor = oldVersion.split('.')[0];
  const newMajor = newVersion.split('.')[0];
  const isMajorBump = oldMajor !== newMajor;

  console.log(`✓ ${type}: ${oldVersion} → ${newVersion}`);
  if (isMajorBump) {
    console.log(
      '  ⚠ Bump de MAJOR — usuários precisarão reaceitar no próximo login.',
    );
  } else {
    console.log('  ℹ Bump de MINOR — aceite anterior continua válido.');
  }
}

main();
