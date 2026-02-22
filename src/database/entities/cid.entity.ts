import { Entity, Column } from 'typeorm';

@Entity('cid')
export class Cid {
  @Column({ type: 'varchar', length: 75, primary: true })
  id: string;

  @Column({ type: 'varchar', length: 75 })
  description: string;
}
