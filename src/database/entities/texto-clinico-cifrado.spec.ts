import { getMetadataArgsStorage } from 'typeorm';
import { Patient } from './patient.entity';
import { ClinicalRecord } from './clinical-record.entity';
import { ClinicalSnippet } from './clinical-snippet.entity';
import { WhatsappConversationMessage } from './whatsapp-conversation-message.entity';
import { encryptedTransformer } from '../../shared/crypto/encryption.util';

function transformerDe(alvo: object, propriedade: string): unknown {
  const coluna = getMetadataArgsStorage().columns.find(
    (c) => c.target === alvo && c.propertyName === propriedade,
  );
  return coluna?.options.transformer;
}

describe('texto clínico cifrado em repouso', () => {
  it.each([
    [Patient, 'medicalNotes'],
    [ClinicalRecord, 'anamnesis'],
    [ClinicalRecord, 'physicalExam'],
    [ClinicalRecord, 'diagnosis'],
    [ClinicalRecord, 'conduct'],
    [WhatsappConversationMessage, 'content'],
    [ClinicalSnippet, 'content'],
  ])('%p.%s usa o encryptedTransformer', (entidade, propriedade) => {
    expect(transformerDe(entidade, propriedade)).toBe(encryptedTransformer);
  });

  it('colunas cifradas são text (o texto cifrado é maior que o original)', () => {
    const colunas = getMetadataArgsStorage().columns.filter(
      (c) => c.options.transformer === encryptedTransformer,
    );
    expect(colunas.length).toBeGreaterThanOrEqual(7);
    for (const c of colunas) {
      expect(c.options.type).toBe('text');
    }
  });
});
