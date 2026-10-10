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
  patientCpfMissing: boolean;
  patientMatchedByCpf: boolean;
  candidates: ExtractFromDocumentCandidates;
  tempStoragePath: string;
}
