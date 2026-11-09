import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { templateLabel } from './template-label';

describe('templateLabel', () => {
  it('traduz o SID do WhatsApp para o nome do aviso', () => {
    expect(templateLabel(WHATSAPP_TEMPLATES.STALE_STATUS_MESSAGE)).toBe(
      'Solicitação parada',
    );
  });

  it('traduz o template de e-mail', () => {
    expect(templateLabel('weekly-summary')).toBe('Resumo semanal');
    expect(templateLabel('raw_html')).toBe('E-mail avulso');
  });

  it('devolve null para vazio ou desconhecido', () => {
    expect(templateLabel(null)).toBeNull();
    expect(templateLabel('HXdesconhecido')).toBeNull();
  });
});
