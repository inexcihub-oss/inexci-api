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
