import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/typeorm/data-source';
import { createR2Client } from '../src/config/r2.config';
import { STORAGE_FOLDERS } from '../src/config/storage.config';
import { StorageService } from '../src/shared/storage/storage.service';
import { FOTO_PACIENTE_CONTENT_TYPE } from '../src/shared/storage/foto-paciente';
import { converterFotosExistentes } from '../src/shared/storage/converter-fotos-existentes';

/**
 * Converte as fotos de paciente já gravadas para WebP de até 800 px.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/otimizar-fotos-pacientes.ts \
 *     --owner-email <dono da conta> [--simular]
 *
 * Fotos novas já entram otimizadas (upload e importador); isto é para as que
 * existiam antes. Idempotente: foto já em WebP é pulada.
 */
async function main() {
  const argv = process.argv.slice(2);
  const valor = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = valor('--owner-email')?.toLowerCase();
  const simular = argv.includes('--simular');
  if (!email) throw new Error('--owner-email é obrigatório.');

  const ds = await new DataSource({
    ...dataSourceOptions,
    logging: ['error'],
  }).initialize();
  try {
    const [dono] = await ds.query(
      `SELECT id FROM users WHERE lower(email) = $1 AND id = owner_id AND deleted_at IS NULL`,
      [email],
    );
    if (!dono) throw new Error(`Dono de conta não encontrado: ${email}`);

    const fotos: { patientId: string; ownerId: string; photoPath: string }[] =
      await ds.query(
        `SELECT id AS "patientId", owner_id AS "ownerId", photo_path AS "photoPath"
           FROM patients
          WHERE owner_id = $1 AND photo_path IS NOT NULL AND deleted_at IS NULL`,
        [dono.id],
      );

    const env = {
      get: (chave: string, padrao?: string) => process.env[chave] ?? padrao,
    } as unknown as ConfigService;
    const storage = new StorageService(createR2Client(env), {
      get: () => process.env.R2_BUCKET,
    } as unknown as ConfigService);

    console.log(
      `[fotos] ${fotos.length} fotos na conta${simular ? ' (simulação)' : ''}...`,
    );
    const r = await converterFotosExistentes(
      fotos,
      {
        baixar: (c) => storage.download(c),
        enviar: (conteudo, nome, ownerId) =>
          storage.uploadBuffer(
            conteudo,
            STORAGE_FOLDERS.PATIENT_PHOTOS,
            nome,
            FOTO_PACIENTE_CONTENT_TYPE,
            ownerId,
          ),
        trocarCaminho: async (patientId, antigo, novo) => {
          const [, linhas] = await ds.query(
            `UPDATE patients SET photo_path = $1 WHERE id = $2 AND photo_path = $3`,
            [novo, patientId, antigo],
          );
          return linhas === 1;
        },
        apagar: async (caminhos) => {
          for (let i = 0; i < caminhos.length; i += 1000) {
            await storage.deleteMany(caminhos.slice(i, i + 1000));
          }
        },
      },
      simular,
    );
    const kb = (b: number) => Math.round(b / 1024).toLocaleString('pt-BR');
    console.log(
      `[fotos] convertidas: ${r.convertidas} · já otimizadas: ${r.jaOtimizadas} · falhas: ${r.falhas.length}`,
    );
    console.log(
      `[fotos] tamanho: ${kb(r.bytesAntes)} KB → ${kb(r.bytesDepois)} KB`,
    );
    for (const f of r.falhas)
      console.log(`  falha ${f.patientId}: ${f.motivo}`);
    if (r.falhas.length) process.exitCode = 2;
  } finally {
    await ds.destroy();
  }
}

main().catch((e: Error) => {
  console.error(`[fotos] ${e.message}`);
  process.exit(1);
});
