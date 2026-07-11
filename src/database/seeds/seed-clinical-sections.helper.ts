import type { DataSource } from 'typeorm';
import {
  seedClinicalReportSections as seedSections,
  type ClinicalSeedContent,
} from '../../modules/surgery-requests/utils/clinical-report-sections.util';

export async function seedClinicalReportSections(
  dataSource: DataSource,
  surgeryRequestId: string,
  clinical: ClinicalSeedContent,
): Promise<void> {
  await seedSections(dataSource, surgeryRequestId, clinical);
}
