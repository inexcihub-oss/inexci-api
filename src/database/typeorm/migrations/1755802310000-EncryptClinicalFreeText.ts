import { Logger } from '@nestjs/common';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { hasEncryptionKey } from '../../../shared/crypto/encryption.util';
import {
  cifrarTextoClinicoLegado,
  decifrarTextoClinico,
} from '../backfill/cifrar-texto-clinico';

const logger = new Logger('EncryptClinicalFreeText');

export class EncryptClinicalFreeText1755802310000 implements MigrationInterface {
  name = 'EncryptClinicalFreeText1755802310000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!hasEncryptionKey()) {
      logger.warn(
        'DB_ENCRYPTION_KEY ausente: texto clínico legado mantido em claro (a aplicação cifra a partir da próxima escrita).',
      );
      return;
    }
    const total = await cifrarTextoClinicoLegado((sql, parametros) =>
      queryRunner.query(sql, parametros),
    );
    logger.log(`Texto clínico cifrado em repouso: ${total} valores`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!hasEncryptionKey()) return;
    await decifrarTextoClinico((sql, parametros) =>
      queryRunner.query(sql, parametros),
    );
  }
}
