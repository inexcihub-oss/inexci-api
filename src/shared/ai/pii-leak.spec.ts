describe('Vazamento de PII na camada de IA', () => {
  it('log de execucao de tool nao inclui os argumentos', () => {
    const fonte = require('fs').readFileSync(
      require.resolve('./services/tool-executor.service'),
      'utf8',
    );
    // JSON.stringify(args) no log despejava laudo, diagnostico e nome de
    // paciente no Grafana.
    expect(fonte).not.toMatch(/Executando tool.*JSON\.stringify\(args\)/);
  });

  it('o processador de documento usa conversationId como sessao do cofre', () => {
    const fonte = require('fs').readFileSync(
      require.resolve('./services/whatsapp-document-processor.service'),
      'utf8',
    );
    expect(fonte).not.toMatch(/sessionId:\s*messageSid/);
  });
});
