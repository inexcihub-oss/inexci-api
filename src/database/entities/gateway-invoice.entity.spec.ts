import { DataSource } from 'typeorm';
import { ENTITIES } from './index';

describe('GatewayInvoice (metadados)', () => {
  it('a unicidade de gateway_invoice_id tem o mesmo nome da migration', async () => {
    const dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const meta = dataSource.getMetadata('GatewayInvoice');

    expect(
      meta.uniques.map((u) => [u.name, u.columns.map((c) => c.databaseName)]),
    ).toEqual([
      ['UQ_gateway_invoices_gateway_invoice_id', ['gateway_invoice_id']],
    ]);
    expect(meta.indices.filter((i) => i.isUnique).map((i) => i.name)).toEqual(
      [],
    );
    expect(meta.foreignKeys).toEqual([]);
  });
});
