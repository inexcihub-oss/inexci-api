import { caminhoPdfDoTenant, lerAtividadePdf } from './system-pdf-activity';

function conteudo(dados: Record<string, unknown>) {
  return JSON.stringify(dados);
}

describe('caminhoPdfDoTenant', () => {
  it('aceita o formato gravado pelo StorageService.create', () => {
    expect(caminhoPdfDoTenant('pdfs/owner-1/uuid-arquivo.pdf', 'owner-1')).toBe(
      'pdfs/owner-1/uuid-arquivo.pdf',
    );
  });

  it.each([
    ['outro tenant', 'pdfs/owner-2/x.pdf'],
    ['outra pasta', 'documents/owner-1/x.pdf'],
    ['travessia', 'pdfs/owner-1/../owner-2/x.pdf'],
    ['subpasta', 'pdfs/owner-1/sub/x.pdf'],
    ['prefixo parcial do tenant', 'pdfs/owner-10/x.pdf'],
    ['barra invertida', 'pdfs/owner-1/..\\x.pdf'],
    ['vazio depois do prefixo', 'pdfs/owner-1/'],
    ['caminho absoluto', '/pdfs/owner-1/x.pdf'],
  ])('recusa %s', (_caso, caminho) => {
    expect(caminhoPdfDoTenant(caminho, 'owner-1')).toBeNull();
  });

  it('recusa quando não há tenant ou o caminho não é texto', () => {
    expect(caminhoPdfDoTenant('pdfs/owner-1/x.pdf', null)).toBeNull();
    expect(caminhoPdfDoTenant(42, 'owner-1')).toBeNull();
  });
});

describe('lerAtividadePdf', () => {
  it('devolve o caminho de atividade do sistema no tenant', () => {
    const lida = lerAtividadePdf(
      {
        userId: null,
        content: conteudo({
          description: 'PDF',
          pdf_path: 'pdfs/owner-1/a.pdf',
          contestation_id: 'c-1',
        }),
      },
      'owner-1',
    );
    expect(lida).toEqual({
      description: 'PDF',
      contestationId: 'c-1',
      pdfPath: 'pdfs/owner-1/a.pdf',
    });
  });

  it('recusa caminho de atividade com autor', () => {
    const lida = lerAtividadePdf(
      {
        userId: 'user-1',
        content: conteudo({ pdf_path: 'pdfs/owner-1/a.pdf' }),
      },
      'owner-1',
    );
    expect(lida?.pdfPath).toBeNull();
    expect(lida?.motivoRejeicao).toBe('autor_nao_sistema');
  });

  it('recusa caminho fora do tenant', () => {
    const lida = lerAtividadePdf(
      { userId: null, content: conteudo({ pdf_path: 'pdfs/owner-2/a.pdf' }) },
      'owner-1',
    );
    expect(lida?.pdfPath).toBeNull();
    expect(lida?.motivoRejeicao).toBe('caminho_fora_do_tenant');
  });

  it('sem pdf_path devolve só a descrição, sem rejeição', () => {
    const lida = lerAtividadePdf(
      { userId: null, content: conteudo({ description: 'só texto' }) },
      'owner-1',
    );
    expect(lida).toEqual({
      description: 'só texto',
      contestationId: undefined,
      pdfPath: null,
    });
  });

  it('devolve null para conteúdo que não é JSON objeto', () => {
    expect(lerAtividadePdf({ content: 'texto livre' }, 'owner-1')).toBeNull();
    expect(lerAtividadePdf({ content: '"string"' }, 'owner-1')).toBeNull();
  });
});
