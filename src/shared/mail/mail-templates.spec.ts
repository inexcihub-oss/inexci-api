import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { MAIL_TEMPLATES } from 'src/config/mail.config';

const TEMPLATES_DIR = path.resolve(__dirname, 'templates');
const PARTIALS_DIR = path.resolve(__dirname, 'templates', 'partials');

const MARCADOR_DO_LAYOUT = 'Sistema de Gestão Cirúrgica';

const normalizarEspacos = (texto: string) => texto.replace(/\s+/g, ' ').trim();

function literaisDoCorpo(source: string): string[] {
  const abertura = source.indexOf('\n');
  const fechamento = source.lastIndexOf('{{/_layout}}');
  const corpo =
    abertura >= 0 && fechamento > abertura
      ? source.slice(abertura + 1, fechamento)
      : source;

  return corpo
    .split(/<[^>]*>|\{\{[^}]*\}\}/)
    .map(normalizarEspacos)
    .filter((trecho) => trecho.length >= 8 && !trecho.includes('&'))
    .sort((a, b) => b.length - a.length);
}

function literaisDoTitulo(source: string): string[] {
  const match = source.match(
    /^\{\{#>\s*_layout\s+title=(?:"([^"]*)"|'([^']*)')/,
  );
  const titulo = match?.[1] ?? match?.[2];
  if (!titulo) return [];

  return titulo
    .split(/\{\{[^}]*\}\}/)
    .map(normalizarEspacos)
    .filter((trecho) => trecho.length >= 8 && !trecho.includes('&'));
}

const usaLayout = (source: string) =>
  source.trimStart().startsWith('{{#> _layout');

beforeAll(() => {
  if (fs.existsSync(PARTIALS_DIR)) {
    fs.readdirSync(PARTIALS_DIR)
      .filter((f) => f.endsWith('.hbs'))
      .forEach((file) => {
        const name = file.replace('.hbs', '');
        const source = fs.readFileSync(path.join(PARTIALS_DIR, file), 'utf-8');
        Handlebars.registerPartial(name, source);
      });
  }
});

const mockContext: Record<string, any> = {
  patientName: 'João Silva',
  doctorName: 'Dr. Carlos Souza',
  hospitalName: 'Hospital Exemplo',
  protocol: 'SC-000001',
  statusFrom: 'Pendente',
  statusTo: 'Em Análise',
  status: 'Em Análise',
  newStatus: 'Enviada',
  previousStatus: 'Pendente',
  procedureName: 'Artroscopia de Joelho',
  actionDescription: 'Enviou solicitação',
  userName: 'Dr. Carlos Souza',
  userRole: 'Médico',
  requestDate: '15/04/2026',
  daysSinceLastChange: 7,
  staleTier: '7 dias',
  surgeryDate: '30/04/2026',
  observations: 'Sem observações.',
  link: 'https://app.inexci.com.br/solicitacao/1',
  preferencesUrl: 'https://app.inexci.com.br/configuracoes',
  subject: 'Assunto de teste',
  title: 'Título de teste',
  body: '<p>Conteúdo de teste</p>',
  year: 2026,
  invoiceNumber: 'INV-001',
  amount: 'R$ 5.000,00',
  paymentDate: '20/04/2026',
  contestReason: 'Valor divergente',
  scheduledDate: '30/04/2026',
  scheduledTime: '08:00',
};

describe('Mail Templates — Renderização', () => {
  it('diretório de templates existe', () => {
    expect(fs.existsSync(TEMPLATES_DIR)).toBe(true);
  });

  it('partial _layout existe', () => {
    expect(fs.existsSync(path.join(PARTIALS_DIR, '_layout.hbs'))).toBe(true);
  });

  describe.each(MAIL_TEMPLATES)('template "%s"', (templateName) => {
    const templatePath = path.join(TEMPLATES_DIR, `${templateName}.hbs`);

    it('arquivo .hbs existe', () => {
      expect(fs.existsSync(templatePath)).toBe(true);
    });

    it('compila sem erros', () => {
      const source = fs.readFileSync(templatePath, 'utf-8');
      expect(() => Handlebars.compile(source)).not.toThrow();
    });

    it('renderiza HTML não vazio', () => {
      const source = fs.readFileSync(templatePath, 'utf-8');
      const compiled = Handlebars.compile(source);
      const html = compiled(mockContext);
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(50);
    });

    it('HTML renderizado contém tags básicas', () => {
      const source = fs.readFileSync(templatePath, 'utf-8');
      const compiled = Handlebars.compile(source);
      const html = compiled(mockContext);
      expect(html).toMatch(/<[a-z]/i);
    });

    it('injeta o corpo dentro do layout via @partial-block', () => {
      const source = fs.readFileSync(templatePath, 'utf-8');
      if (!usaLayout(source)) return;

      const html = normalizarEspacos(Handlebars.compile(source)(mockContext));

      expect(html).toContain(MARCADOR_DO_LAYOUT);

      const literais = literaisDoCorpo(source);
      expect(literais.length).toBeGreaterThan(0);

      const encontrados = literais.filter((trecho) => html.includes(trecho));
      expect(encontrados.length).toBeGreaterThan(0);
    });

    it('não passa expressão Handlebars entre aspas no hash do layout', () => {
      const source = fs.readFileSync(templatePath, 'utf-8');
      if (!usaLayout(source)) return;

      const quebra = source.indexOf('\n');
      const abertura = quebra >= 0 ? source.slice(0, quebra) : source;

      expect(abertura).not.toMatch(/=\s*(?:"[^"]*\{\{|'[^']*\{\{)/);
    });

    it('propaga o hash `title` para o cabeçalho do layout', () => {
      const source = fs.readFileSync(templatePath, 'utf-8');
      const literais = literaisDoTitulo(source);
      if (literais.length === 0) return;

      const html = normalizarEspacos(Handlebars.compile(source)(mockContext));
      for (const trecho of literais) {
        expect(html).toContain(trecho);
      }
    });
  });

  it('generic-notification leva o `title` do contexto para o cabeçalho', () => {
    const source = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'generic-notification.hbs'),
      'utf-8',
    );

    const html = Handlebars.compile(source)(mockContext);

    expect(html).toContain(mockContext.title);
    expect(html).not.toContain('{{title}}');
  });

  it(`total de templates corresponde ao config (${MAIL_TEMPLATES.length})`, () => {
    const hbsFiles = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith('.hbs'));
    expect(hbsFiles.length).toBeGreaterThanOrEqual(MAIL_TEMPLATES.length);
  });
});
