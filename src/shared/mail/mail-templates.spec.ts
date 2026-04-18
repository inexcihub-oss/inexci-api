import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { MAIL_TEMPLATES } from 'src/config/mail.config';

/**
 * 10.1.6 — Testes de renderização de todos os templates Handlebars de e-mail.
 * Verifica que cada template:
 * - Existe em disco
 * - Compila sem erros
 * - Renderiza HTML válido com contexto mock
 */

const TEMPLATES_DIR = path.resolve(__dirname, 'templates');
const PARTIALS_DIR = path.resolve(__dirname, 'templates', 'partials');

// Registra partials antes dos testes (mesmo comportamento do MailProcessor)
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

// Contexto mock genérico que cobre variáveis usadas nos templates
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
  // Campos de pagamento
  invoiceNumber: 'INV-001',
  amount: 'R$ 5.000,00',
  paymentDate: '20/04/2026',
  // Campos de contestação
  contestReason: 'Valor divergente',
  // Campos de agendamento
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
      // Deve conter pelo menos algum HTML
      expect(html).toMatch(/<[a-z]/i);
    });
  });

  it(`total de templates corresponde ao config (${MAIL_TEMPLATES.length})`, () => {
    const hbsFiles = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith('.hbs'));
    // Templates em disco >= templates no config (pode haver partials na raiz)
    expect(hbsFiles.length).toBeGreaterThanOrEqual(MAIL_TEMPLATES.length);
  });
});
