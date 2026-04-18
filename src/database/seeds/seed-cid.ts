import { Logger } from '@nestjs/common';
import { SeedDataSource } from '../typeorm/seed-data-source';
import * as cidData from '../../utils/cid.json';

const logger = new Logger('SeedCid');

interface CidItem {
  codigo: string;
  descricao: string;
}

async function seedCid() {
  logger.log('🔌 Conectando ao banco de dados...');
  await SeedDataSource.initialize();

  const queryRunner = SeedDataSource.createQueryRunner();

  try {
    const rows = (cidData as { rows: CidItem[] }).rows;
    logger.log(`📋 Total de registros CID a inserir: ${rows.length}`);

    // Inserir em lotes de 500
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      const values = batch
        .map((item) => {
          const code = item.codigo.replace(/'/g, "''");
          const desc = item.descricao.replace(/'/g, "''");
          return `('${code}', '${desc}')`;
        })
        .join(',\n');

      await queryRunner.query(`
        INSERT INTO "cid" ("code", "description")
        VALUES ${values}
        ON CONFLICT ("code") DO NOTHING;
      `);

      inserted += batch.length;
      logger.log(`  ✅ Inseridos ${inserted}/${rows.length} registros CID`);
    }

    logger.log('🎉 Seed CID concluído com sucesso!');
  } catch (error) {
    logger.error('❌ Erro ao executar seed CID:', error);
    throw error;
  } finally {
    await queryRunner.release();
    await SeedDataSource.destroy();
  }
}

seedCid();
