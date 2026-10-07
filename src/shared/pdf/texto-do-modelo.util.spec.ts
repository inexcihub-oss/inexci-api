import { limparTextoDoModelo } from './texto-do-modelo.util';

const medico = { nome: 'Ana Souza', registro: 'CRM 123456/RJ' };

describe('limparTextoDoModelo', () => {
  it('tira o título do topo e o bloco de assinatura do fim', () => {
    const texto = [
      'ATESTADO MÉDICO',
      '',
      'Atesto, para os devidos fins, que Maria foi atendida nesta data.',
      '',
      '---',
      '',
      'Dr.(a) Ana Souza',
      'CRM CRM 123456/RJ',
    ].join('\n');

    expect(limparTextoDoModelo(texto, medico)).toBe(
      'Atesto, para os devidos fins, que Maria foi atendida nesta data.',
    );
  });

  it('mantém parágrafos do meio, inclusive linhas em branco entre eles', () => {
    const texto =
      'Primeiro parágrafo.\n\nSegundo parágrafo.\n\nAssinatura e carimbo';

    expect(limparTextoDoModelo(texto, medico)).toBe(
      'Primeiro parágrafo.\n\nSegundo parágrafo.',
    );
  });

  it('não confunde frase longa do corpo que cita o médico com assinatura', () => {
    const texto =
      'Eu, Dr.(a) Ana Souza, CRM 123456/RJ, atesto que Maria esteve em consulta nesta data e deve repousar.';

    expect(limparTextoDoModelo(texto, medico)).toBe(texto);
  });

  it('título só é removido quando é a linha inteira', () => {
    const texto = 'Atestado de que Maria compareceu à consulta.';

    expect(limparTextoDoModelo(texto, medico)).toBe(texto);
  });

  it('reconhece título sem acento e do pedido de exame', () => {
    expect(limparTextoDoModelo('atestado medico\nTexto.', medico)).toBe(
      'Texto.',
    );
    expect(
      limparTextoDoModelo('SOLICITAÇÃO DE EXAMES\nDor lombar.', medico),
    ).toBe('Dor lombar.');
    expect(
      limparTextoDoModelo('Requisição de Exames\nInvestigar anemia.', medico),
    ).toBe('Investigar anemia.');
    expect(limparTextoDoModelo('PEDIDO MÉDICO\nDor.', medico)).toBe('Dor.');
  });

  it('modelo que era só título e assinatura volta como veio', () => {
    const texto = 'ATESTADO MÉDICO\n---\nDr. Ana Souza';

    expect(limparTextoDoModelo(texto, medico)).toBe(texto);
  });

  it('texto sem nada a limpar sai igual', () => {
    expect(limparTextoDoModelo('  Repouso por 3 dias.  ', medico)).toBe(
      'Repouso por 3 dias.',
    );
  });
});
