import { Logger } from '@nestjs/common';
import { SeedDataSource } from '../typeorm/seed-data-source';
import * as tussData from '../../utils/tuss.json';

const logger = new Logger('SeedTuss');

interface TussItem {
  codigo: number;
  procedimento: string;
}

async function seedTuss() {
  logger.log('🔌 Conectando ao banco de dados...');
  await SeedDataSource.initialize();

  const queryRunner = SeedDataSource.createQueryRunner();

  try {
    const rows = (tussData as { rows: TussItem[] }).rows;
    logger.log(`📋 Total de registros TUSS a inserir: ${rows.length}`);

    // Inserir em lotes de 500
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      const values = batch
        .map((item) => {
          const code = item.codigo.toString();
          const proc = item.procedimento.replace(/'/g, "''");
          return `('${code}', '${proc}')`;
        })
        .join(',\n');

      await queryRunner.query(`
        INSERT INTO "tuss" ("code", "procedure")
        VALUES ${values}
        ON CONFLICT ("code") DO NOTHING;
      `);

      inserted += batch.length;
      logger.log(`  ✅ Inseridos ${inserted}/${rows.length} registros TUSS`);
    }

    logger.log('🎉 Seed TUSS concluído com sucesso!');
  } catch (error) {
    logger.error('❌ Erro ao executar seed TUSS:', error);
    throw error;
  } finally {
    await queryRunner.release();
    await SeedDataSource.destroy();
  }
}

seedTuss();
