import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `opme_items.name` nasceu como varchar(75), curto demais para nomes reais de
 * material (ex.: "Placa de titânio bloqueada 4.5mm com 8 furos, sistema LCP")
 * e derrubava o INSERT com "value too long" sem validação prévia no DTO.
 * Alarga para 255, o padrão do restante do schema. Alargar é seguro — não há
 * dado existente que passe a violar a constraint.
 */
export class WidenOpmeItemNameColumn1755700300000 implements MigrationInterface {
  name = 'WidenOpmeItemNameColumn1755700300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "opme_items" ALTER COLUMN "name" TYPE character varying(255)`,
    );
  }

  /**
   * Reversão é destrutiva de propósito: nomes gravados acima de 75 caracteres
   * durante o período em que a coluna aceitava 255 não têm como ser truncados
   * silenciosamente sem perder informação, então o down aborta em vez de
   * cortar dado.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const longos = await queryRunner.query(
      `SELECT id, name FROM "opme_items" WHERE length("name") > 75`,
    );
    if (longos.length > 0) {
      throw new Error(
        `Não é possível reverter: ${longos.length} registro(s) de opme_items têm "name" com mais de 75 caracteres (ex.: id ${longos[0].id}). Ajuste os dados manualmente antes de reverter.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "opme_items" ALTER COLUMN "name" TYPE character varying(75)`,
    );
  }
}
