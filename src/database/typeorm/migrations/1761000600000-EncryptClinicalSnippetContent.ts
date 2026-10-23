import { Logger } from '@nestjs/common';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { hasEncryptionKey } from '../../../shared/crypto/encryption.util';
import {
  cifrarTextoClinicoLegado,
  COLUNAS_TEXTOS_RAPIDOS_CIFRADAS,
  decifrarTextoClinico,
} from '../backfill/cifrar-texto-clinico';

const logger = new Logger('EncryptClinicalSnippetContent');

export class EncryptClinicalSnippetContent1761000600000 implements MigrationInterface {
  name = 'EncryptClinicalSnippetContent1761000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!hasEncryptionKey()) {
      logger.warn(
        'DB_ENCRYPTION_KEY ausente: textos rápidos mantidos em claro (a aplicação cifra a partir da próxima escrita).',
      );
      return;
    }
    const total = await cifrarTextoClinicoLegado(
      (sql, parametros) => queryRunner.query(sql, parametros),
      undefined,
      COLUNAS_TEXTOS_RAPIDOS_CIFRADAS,
    );
    logger.log(`Textos rápidos cifrados em repouso: ${total} valores`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!hasEncryptionKey()) return;
    await decifrarTextoClinico(
      (sql, parametros) => queryRunner.query(sql, parametros),
      undefined,
      COLUNAS_TEXTOS_RAPIDOS_CIFRADAS,
    );
  }
}
