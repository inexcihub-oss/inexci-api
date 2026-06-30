import { PiiVaultService } from './pii-vault.service';

describe('PiiVaultService', () => {
  let service: PiiVaultService;
  const sid = 'conv-1';

  beforeEach(() => {
    service = new PiiVaultService();
    service.startSession(sid);
  });

  describe('tokenize', () => {
    it('retorna placeholder no formato {{<category>_<n>}}', () => {
      const token = service.tokenize(sid, 'João Silva', 'patient_name');
      expect(token).toBe('{{patient_name_1}}');
    });

    it('reusa o mesmo placeholder para o mesmo valor + categoria', () => {
      const a = service.tokenize(sid, 'João Silva', 'patient_name');
      const b = service.tokenize(sid, 'João Silva', 'patient_name');
      expect(a).toBe(b);
    });

    it('incrementa índice para valores diferentes na mesma categoria', () => {
      const a = service.tokenize(sid, 'João Silva', 'patient_name');
      const b = service.tokenize(sid, 'Maria Souza', 'patient_name');
      expect(a).toBe('{{patient_name_1}}');
      expect(b).toBe('{{patient_name_2}}');
    });

    it('mantém índices independentes por categoria', () => {
      const patient = service.tokenize(sid, 'João', 'patient_name');
      const hospital = service.tokenize(sid, 'Hospital X', 'hospital_name');
      expect(patient).toBe('{{patient_name_1}}');
      expect(hospital).toBe('{{hospital_name_1}}');
    });

    it('retorna string vazia para null/undefined/vazio', () => {
      expect(service.tokenize(sid, null, 'patient_name')).toBe('');
      expect(service.tokenize(sid, undefined, 'patient_name')).toBe('');
      expect(service.tokenize(sid, '   ', 'patient_name')).toBe('');
    });

    it('aceita números (CPFs/protocolo) e converte para string', () => {
      const cpf = service.tokenize(sid, 12345678901, 'cpf');
      expect(cpf).toBe('{{cpf_1}}');
    });

    it('cria a sessão sob demanda quando tokenize é chamado antes de startSession', () => {
      const token = service.tokenize(
        'lazy-session',
        'João Silva',
        'patient_name',
      );
      expect(token).toBe('{{patient_name_1}}');
      expect(service.hasSession('lazy-session')).toBe(true);
    });

    it('sem sessionId (string vazia) não tokeniza e devolve o valor', () => {
      expect(service.tokenize('', 'João Silva', 'patient_name')).toBe(
        'João Silva',
      );
    });
  });

  describe('detokenize', () => {
    it('substitui placeholders pelos valores reais', () => {
      const token = service.tokenize(sid, 'João Silva', 'patient_name');
      const text = `Olá ${token}, tudo bem?`;
      expect(service.detokenize(sid, text)).toBe('Olá João Silva, tudo bem?');
    });

    it('é idempotente quando aplicado duas vezes', () => {
      const token = service.tokenize(sid, 'João Silva', 'patient_name');
      const text = `Olá ${token}.`;
      const once = service.detokenize(sid, text);
      const twice = service.detokenize(sid, once);
      expect(twice).toBe(once);
    });

    it('não altera texto quando não há placeholders', () => {
      service.tokenize(sid, 'João Silva', 'patient_name');
      expect(service.detokenize(sid, 'texto puro')).toBe('texto puro');
    });

    it('lida com sessão sem bindings', () => {
      service.startSession('vazia');
      expect(service.detokenize('vazia', 'qualquer texto')).toBe(
        'qualquer texto',
      );
    });
  });

  describe('detectResidualPii', () => {
    it('detecta CPF não tokenizado (com máscara)', () => {
      const findings = service.detectResidualPii(
        'O CPF é 123.456.789-00 obrigado.',
      );
      expect(findings.some((f) => f.category === 'cpf')).toBe(true);
    });

    it('detecta CPF cru (11 dígitos)', () => {
      const findings = service.detectResidualPii('cpf 12345678901');
      expect(findings.some((f) => f.category === 'cpf')).toBe(true);
    });

    it('detecta RG não tokenizado', () => {
      const findings = service.detectResidualPii(
        'ID: 27.903.040-7 DETRAN-RJ',
      );
      expect(findings.some((f) => f.category === 'rg')).toBe(true);
    });

    it('detecta telefone brasileiro', () => {
      const findings = service.detectResidualPii(
        'me liga em (31) 98908-5791 hoje',
      );
      expect(findings.some((f) => f.category === 'phone')).toBe(true);
    });

    it('detecta email', () => {
      const findings = service.detectResidualPii(
        'contato: medico@example.com.br',
      );
      expect(findings.some((f) => f.category === 'email')).toBe(true);
    });

    it('não acusa quando texto é seguro', () => {
      const findings = service.detectResidualPii(
        'A solicitação {{patient_name_1}} foi atualizada.',
      );
      expect(findings).toHaveLength(0);
    });
  });

  describe('maskLiteralPii', () => {
    it('mascara telefone literal por placeholder genérico', () => {
      const result = service.maskLiteralPii(
        'Use o formato 31 99999-9999 para responder.',
      );
      expect(result.text).toBe(
        'Use o formato (DDD) NNNNN-NNNN para responder.',
      );
      expect(result.masked).toEqual([{ category: 'phone', count: 1 }]);
    });

    it('mascara CPF formatado por placeholder genérico', () => {
      const result = service.maskLiteralPii('CPF do paciente: 123.456.789-00.');
      expect(result.text).toBe('CPF do paciente: XXX.XXX.XXX-XX.');
      expect(result.masked).toEqual([{ category: 'cpf', count: 1 }]);
    });

    it('mascara RG formatado por placeholder genérico', () => {
      const result = service.maskLiteralPii('RG do paciente: 27.903.040-7.');
      expect(result.text).toBe('RG do paciente: XX.XXX.XXX-X.');
      expect(result.masked).toEqual([{ category: 'rg', count: 1 }]);
    });

    it('mascara email literal por exemplo genérico', () => {
      const result = service.maskLiteralPii(
        'Cadastre o e-mail joao@example.com agora.',
      );
      expect(result.text).toBe('Cadastre o e-mail exemplo@dominio.com agora.');
      expect(result.masked).toEqual([{ category: 'email', count: 1 }]);
    });

    it('preserva placeholders válidos do vault', () => {
      const result = service.maskLiteralPii(
        'Paciente {{patient_name_1}}, telefone 11 91234-5678 confirmado.',
      );
      expect(result.text).toBe(
        'Paciente {{patient_name_1}}, telefone (DDD) NNNNN-NNNN confirmado.',
      );
    });

    it('é idempotente: aplicar duas vezes não corrompe o texto', () => {
      const once = service.maskLiteralPii(
        'CPF 123.456.789-00, fone (31) 98908-5791.',
      ).text;
      const twice = service.maskLiteralPii(once).text;
      expect(twice).toBe(once);
    });

    it('texto sem PII permanece igual', () => {
      const result = service.maskLiteralPii(
        'Solicitação criada com sucesso. Acesse a plataforma.',
      );
      expect(result.text).toBe(
        'Solicitação criada com sucesso. Acesse a plataforma.',
      );
      expect(result.masked).toEqual([]);
    });
  });

  describe('startSession / endSession', () => {
    it('endSession remove bindings da sessão', () => {
      service.tokenize(sid, 'João', 'patient_name');
      service.endSession(sid);
      expect(service.hasSession(sid)).toBe(false);
    });

    it('sessões diferentes não compartilham bindings', () => {
      service.startSession('s2');
      service.tokenize(sid, 'João', 'patient_name');
      service.tokenize('s2', 'Maria', 'patient_name');

      expect(service.snapshot(sid)).toHaveLength(1);
      expect(service.snapshot('s2')).toHaveLength(1);
      expect(service.snapshot(sid)[0].realValue).toBe('João');
      expect(service.snapshot('s2')[0].realValue).toBe('Maria');
    });
  });

  describe('serializeSession / restoreSession', () => {
    it('serializeSession devolve cópia dos bindings (JSON-safe)', () => {
      service.tokenize(sid, 'João Silva', 'patient_name');
      // tokenize de protocolo NORMALIZA o realValue (strip SC-), porque o
      // banco armazena o protocolo sem prefixo. As tools prefixam "SC-"
      // FORA do placeholder na resposta para o usuário (regressão SC-SC-).
      service.tokenize(sid, 'SC-0042', 'protocol');

      const snapshot = service.serializeSession(sid);
      expect(snapshot).toEqual([
        {
          token: '{{patient_name_1}}',
          category: 'patient_name',
          realValue: 'João Silva',
        },
        {
          token: '{{protocol_1}}',
          category: 'protocol',
          realValue: '0042',
        },
      ]);

      // Mutar o snapshot não deve afetar a sessão.
      snapshot.push({
        token: '{{cpf_1}}',
        category: 'cpf',
        realValue: '123',
      });
      expect(service.snapshot(sid)).toHaveLength(2);
    });

    it('restoreSession permite detokenizar placeholders salvos em turno anterior', () => {
      // Simula bindings persistidos no turno anterior (Redis/banco).
      // Note: realValue de protocol é armazenado SEM prefixo "SC-".
      const persisted = [
        {
          token: '{{protocol_1}}',
          category: 'protocol' as const,
          realValue: '0042',
        },
        {
          token: '{{patient_name_1}}',
          category: 'patient_name' as const,
          realValue: 'João Silva',
        },
      ];

      service.startSession('nova-sessao');
      service.restoreSession('nova-sessao', persisted);

      const text = '1 - SC-{{protocol_1}} — {{patient_name_1}} — Finalizada';
      expect(service.detokenize('nova-sessao', text)).toBe(
        '1 - SC-0042 — João Silva — Finalizada',
      );
    });

    // Regressão SC-SC-: bindings persistidos ANTES do fix gravavam
    // realValue="SC-0042". Sem normalização no restoreSession, o detokenize
    // de "SC-{{protocol_1}}" produzia "SC-SC-0042" no WhatsApp.
    it('restoreSession normaliza realValue de protocol legado removendo prefixo SC-', () => {
      const persistedLegacy = [
        {
          token: '{{protocol_1}}',
          category: 'protocol' as const,
          realValue: 'SC-0042',
        },
        {
          token: '{{protocol_2}}',
          category: 'protocol' as const,
          realValue: 'SC-SC-468131',
        },
      ];

      service.startSession('legacy-sess');
      service.restoreSession('legacy-sess', persistedLegacy);

      const snapshot = service.serializeSession('legacy-sess');
      expect(snapshot[0].realValue).toBe('0042');
      expect(snapshot[1].realValue).toBe('468131');

      const text = 'A SC-{{protocol_1}} e a SC-{{protocol_2}} estão prontas.';
      expect(service.detokenize('legacy-sess', text)).toBe(
        'A SC-0042 e a SC-468131 estão prontas.',
      );
    });

    it('restoreSession é idempotente (não duplica bindings)', () => {
      const persisted = [
        {
          token: '{{patient_name_1}}',
          category: 'patient_name' as const,
          realValue: 'João Silva',
        },
      ];

      service.restoreSession(sid, persisted);
      service.restoreSession(sid, persisted);

      expect(service.snapshot(sid)).toHaveLength(1);
    });

    it('restoreSession ignora bindings malformados sem quebrar a sessão', () => {
      const persisted: any[] = [
        {
          token: '{{patient_name_1}}',
          category: 'patient_name',
          realValue: 'João Silva',
        },
        { token: null, category: 'patient_name', realValue: 'X' },
        { token: '{{x_1}}', category: 'patient_name', realValue: null },
      ];

      service.restoreSession('s-novo', persisted);
      expect(service.snapshot('s-novo')).toHaveLength(1);
    });

    it('restoreSession + tokenize subsequente continua a sequência sem colidir', () => {
      const persisted = [
        {
          token: '{{patient_name_1}}',
          category: 'patient_name' as const,
          realValue: 'João Silva',
        },
      ];

      service.startSession('s-novo');
      service.restoreSession('s-novo', persisted);

      const next = service.tokenize('s-novo', 'Maria Souza', 'patient_name');
      expect(next).toBe('{{patient_name_2}}');
    });
  });

  describe('preprocessUserInput', () => {
    it('tokeniza apenas dados sensíveis estruturados (CPF, telefone, e-mail)', () => {
      const out = service.preprocessUserInput(
        sid,
        'Paciente Joao, CPF 529.982.247-25, tel (11) 98888-7777, email joao@x.com',
      );
      expect(out).toMatch(/\{\{cpf_\d+\}\}/);
      expect(out).toMatch(/\{\{phone_\d+\}\}/);
      expect(out).toMatch(/\{\{email_\d+\}\}/);
      expect(out).toContain('Paciente Joao');
      expect(out).not.toContain('529.982.247-25');
      expect(out).not.toContain('98888-7777');
      expect(out).not.toContain('joao@x.com');
    });

    it('tokeniza RG no formato "XX.XXX.XXX-X" sem afetar CPF/TUSS adjacentes', () => {
      const out = service.preprocessUserInput(
        sid,
        'Lucas Bruno Borges de Medeiros\nDN 26/10/1995 / ID: 27.903.040-7 DETRAN-RJ / CPF 168.508.057-03',
      );
      expect(out).toMatch(/\{\{rg_\d+\}\}/);
      expect(out).toMatch(/\{\{cpf_\d+\}\}/);
      expect(out).not.toContain('27.903.040-7');
      expect(out).not.toContain('168.508.057-03');
      expect(out).toContain('Lucas Bruno Borges de Medeiros');
    });

    it('não confunde código TUSS (sem traço final) com RG', () => {
      const out = service.preprocessUserInput(
        sid,
        'Código TUSS solicitado: 3.07.15.091 - Descompressão cervical',
      );
      expect(out).not.toMatch(/\{\{rg_\d+\}\}/);
      expect(out).toContain('3.07.15.091');
    });

    it('NÃO transforma laudos longos (> 1500 chars) em payload_blob por padrão', () => {
      // Comportamento esperado pós-fix: o blobThreshold padrão é Infinity.
      // Antes (default 1500) qualquer laudo médico era reduzido a um único
      // `{{payload_blob_n}}` e o classifier devolvia `kind=unknown`.
      const longLaudo =
        'Diagnóstico: artrose. ' +
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
      expect(longLaudo.length).toBeGreaterThan(1500);

      const out = service.preprocessUserInput(sid, longLaudo);
      expect(out).not.toMatch(/\{\{payload_blob_\d+\}\}/);
      expect(out).toContain('Diagnóstico: artrose');
      expect(out).toContain('Lorem ipsum');
    });

    it('aplica payload_blob apenas quando o caller passa blobThreshold finito explicitamente', () => {
      const longText = 'algum texto enorme '.repeat(200) + 'mais coisa final';
      expect(longText.length).toBeGreaterThan(1500);

      const out = service.preprocessUserInput(sid, longText, {
        blobThreshold: 1500,
      });
      expect(out).toMatch(/^\{\{payload_blob_\d+\}\}$/);
    });
  });

  describe('categoryCounts', () => {
    it('conta corretamente tokens por categoria', () => {
      service.tokenize(sid, 'João', 'patient_name');
      service.tokenize(sid, 'Maria', 'patient_name');
      service.tokenize(sid, 'Hospital X', 'hospital_name');

      const counts = service.categoryCounts(sid);
      expect(counts.patient_name).toBe(2);
      expect(counts.hospital_name).toBe(1);
      expect(counts.cpf).toBe(0);
    });
  });

  describe('hashValue', () => {
    it('é determinístico para o mesmo input', () => {
      expect(service.hashValue('123.456.789-00')).toBe(
        service.hashValue('123.456.789-00'),
      );
    });

    it('produz hashes diferentes para inputs diferentes', () => {
      expect(service.hashValue('A')).not.toBe(service.hashValue('B'));
    });

    it('retorna string vazia para input vazio', () => {
      expect(service.hashValue('')).toBe('');
    });
  });
});
