import { PiiVaultService } from '../services/pii-vault.service';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './system-prompt';

describe('SYSTEM_PROMPT', () => {
  it('expõe versão e conteúdo não vazios', () => {
    expect(typeof PROMPT_VERSION).toBe('string');
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(100);
  });

  // Regressão: o prompt já chegou a conter literais de PII estruturada
  // (ex.: "123.456.789-00", "11 99999-9999", "exemplo@dominio.com") usados
  // como exemplos negativos. O `assertNoResidualPii` rodando antes da
  // chamada à OpenAI detectava esses literais e bloqueava 100% das
  // mensagens com erro `PII_RESIDUAL`. O prompt deve usar APENAS
  // placeholders abstratos — sem dígitos e sem `@<dominio>` real.
  it('não contém literais de CPF/telefone/e-mail que disparem o filtro defensivo', () => {
    const vault = new PiiVaultService();
    const findings = vault.detectResidualPii(SYSTEM_PROMPT);
    expect(findings).toEqual([]);
  });

  // O prompt foi reescrito (1.3.x) para um tom mais gentil, com emojis
  // moderados e oferta de próximos passos. Estes asserts garantem que
  // futuras edições não regridam para o comportamento robotizado anterior.
  it('orienta a IA a usar tom gentil e emojis com parcimônia', () => {
    expect(SYSTEM_PROMPT).toMatch(/gentil/i);
    expect(SYSTEM_PROMPT).toMatch(/emojis/i);
    expect(SYSTEM_PROMPT).toMatch(/parcim/i);
  });

  it('orienta a IA a oferecer próximos passos como opções numeradas', () => {
    expect(SYSTEM_PROMPT).toMatch(/pr[óo]ximos passos/i);
    expect(SYSTEM_PROMPT).toMatch(/op[çc][õo]es numeradas/i);
    expect(SYSTEM_PROMPT).toMatch(/1 - /);
  });
});
