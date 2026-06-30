import {
  DocumentClassificationKind,
  DocumentClassificationExtracted,
} from 'src/shared/ai/ocr/document-classifier.types';
import {
  EntityCandidate,
  PatientCandidate,
} from '../services/document-entity-resolver.service';

export interface ExtractFromDocumentCandidates {
  patient: PatientCandidate[];
  hospital: EntityCandidate[];
  healthPlan: EntityCandidate[];
  procedure: EntityCandidate[];
}

export class ExtractFromDocumentResponseDto {
  kind: DocumentClassificationKind;
  confidence: number;
  extracted: DocumentClassificationExtracted;
  suggestedDocumentType: string;
  ambiguity?: string;
  /** true quando o documento trouxe nome de paciente mas não o CPF. */
  patientCpfMissing: boolean;
  /** true quando há match exato de CPF na base. */
  patientMatchedByCpf: boolean;
  candidates: ExtractFromDocumentCandidates;
  /**
   * Caminho temporário do arquivo no storage (usado ao criar a SC
   * via `POST /surgery-requests/from-document`).
   */
  tempStoragePath: string;
}
