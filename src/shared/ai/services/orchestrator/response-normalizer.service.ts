import { Injectable, Logger } from '@nestjs/common';
import {
  MAX_RESPONSE_LENGTH as _MAX_RESPONSE_LENGTH,
  WHATSAPP_TARGET_LENGTH as _WHATSAPP_TARGET_LENGTH,
} from '../../constants/ai.constants';

// Re-exports mantidos para compatibilidade com imports existentes (Fase 9).
export const MAX_RESPONSE_LENGTH = _MAX_RESPONSE_LENGTH;
export const WHATSAPP_TARGET_LENGTH = _WHATSAPP_TARGET_LENGTH;

/**
 * Limite "macio" de emojis por resposta para manter o tom amigável sem
 * transformar a mensagem em uma parede de figuras. Excedentes são removidos
 * silenciosamente preservando o texto.
 *
 * Hoje a política é "ZERO emojis", então a função efetivamente remove
 * qualquer emoji que o LLM produza. Mantemos a constante para preservar
 * a possibilidade de reativar um teto pequeno no futuro sem mudar a API.
 */
export const MAX_EMOJIS_PER_RESPONSE = 0;

/**
 * Termos genéricos por categoria de placeholder PII usados como fallback
 * quando o vault não tem o binding correspondente (alucinação da IA ou
 * binding perdido entre turnos).
 */
const RESIDUAL_PLACEHOLDER_FALLBACKS: Record<string, string> = {
  protocol: 'essa solicitação',
  patient_name: 'o paciente',
  doctor_name: 'o médico',
  hospital_name: 'o hospital',
  health_plan_name: 'o convênio',
  cpf: '[CPF não disponível]',
  phone: '[telefone não disponível]',
  email: '[e-mail não disponível]',
  address: '[endereço não disponível]',
  date: 'a data informada',
  birthDate: 'a data de nascimento',
  medicalReport: '[laudo]',
  patientHistory: '[histórico clínico]',
  diagnosis: '[diagnóstico]',
  surgeryDescription: '[descrição cirúrgica]',
  payload_blob: '[conteúdo enviado]',
};

const PLACEHOLDER_REGEX = /\{\{([a-z_]+)_(\d+)\}\}/gi;

/**
 * Sanitiza o texto livre devolvido pelo LLM antes de despachar para o
 * WhatsApp. Duas responsabilidades:
 *
 * 1. **Normalização de Markdown** (`normalizeWhatsappText`) — strip de blocos
 *    de código, JSON-like, headers, links, tabelas, sublinhados, negrito;
 *    converte listas em opções numeradas; trunca em `WHATSAPP_TARGET_LENGTH`.
 * 2. **Remoção de placeholders residuais** (`scrubResidualPlaceholders`) —
 *    troca `{{categoria_n}}` que escaparam ao detokenize por termos neutros.
 *
 * Extraído do `AiOrchestratorService` na Fase 1 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`. Cada método é puro (depende apenas
 * dos argumentos, não de DI), o que torna o serviço trivialmente testável.
 */
@Injectable()
export class ResponseNormalizerService {
  private readonly logger = new Logger(ResponseNormalizerService.name);

  /**
   * Aplica todas as regras de saneamento do texto destinado ao WhatsApp:
   * remove blocos de código, JSON inline, headers, tabelas, formatação
   * Markdown, emojis (≤ `MAX_EMOJIS_PER_RESPONSE`), colapsa linhas vazias
   * duplicadas, converte listas em opções numeradas e trunca em
   * `WHATSAPP_TARGET_LENGTH` quando excedido.
   */
  normalizeWhatsappText(text: string): string {
    let raw = text || '';

    raw = raw.replace(/```[\s\S]*?```/g, '');

    if (/\{\s*"[^"]+"\s*:/m.test(raw)) {
      this.logger.warn(
        '[NORMALIZE_WHATSAPP_TEXT] JSON-like payload detected and stripped',
      );
      raw = raw.replace(/\{[^{}]*"[^"]+"\s*:[^{}]*\}/g, '');
      raw = raw.replace(/^\s*[{[][\s\S]*?[}\]]\s*$/gm, '');
    }

    const limitedEmojiText = this.limitEmojis(raw, MAX_EMOJIS_PER_RESPONSE);
    const cleanedEmojiText = this.cleanEmojiArtifacts(limitedEmojiText);
    const normalizedLines = cleanedEmojiText
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
      .filter((line) => !/^\|.*\|$/.test(line))
      .map((line) => {
        let current = line;
        current = current.replace(/^#+\s*/g, '');
        current = current.replace(/^[-*]\s+/g, '• ');
        current = current.replace(/\*\*(.*?)\*\*/g, '$1');
        current = current.replace(/__(.*?)__/g, '$1');
        current = current.replace(/\*(.*?)\*/g, '$1');
        current = current.replace(/`([^`]+)`/g, '$1');
        current = current.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        current = current.replace(/\s{2,}/g, ' ');
        return current;
      });

    const optionLines = this.convertListLinesToOptions(normalizedLines);

    let output = optionLines.join('\n').trim();

    if (
      (output.startsWith('"') && output.endsWith('"')) ||
      (output.startsWith("'") && output.endsWith("'"))
    ) {
      output = output.slice(1, -1).trim();
    }

    if (!output) {
      output = 'Desculpe, não consegui processar sua solicitação.';
    }

    if (output.length > WHATSAPP_TARGET_LENGTH) {
      output =
        output.slice(0, WHATSAPP_TARGET_LENGTH - 45).trimEnd() +
        '\n\n_Acesse a plataforma para mais detalhes._';
    }

    return output;
  }

  /**
   * Remove placeholders `{{categoria_n}}` que escaparam ao detokenize.
   * Substitui por termos neutros baseados na categoria e loga a ocorrência
   * para investigação posterior. Sintoma típico: `{{protocol_1}}` chegando
   * cru no WhatsApp porque a IA alucinou um placeholder ou o vault perdeu
   * o binding entre turnos.
   */
  scrubResidualPlaceholders(
    text: string,
    sessionId: string,
    messageSid: string,
  ): string {
    if (!text) return text;
    PLACEHOLDER_REGEX.lastIndex = 0;
    if (!PLACEHOLDER_REGEX.test(text)) return text;

    PLACEHOLDER_REGEX.lastIndex = 0;
    const seen = new Map<string, number>();

    const cleaned = text.replace(PLACEHOLDER_REGEX, (_match, category) => {
      const key = String(category || '').toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
      return (
        RESIDUAL_PLACEHOLDER_FALLBACKS[key] ?? '[informação não disponível]'
      );
    });

    if (seen.size) {
      const breakdown = Array.from(seen.entries())
        .map(([cat, count]) => `${cat}=${count}`)
        .join(',');
      this.logger.warn(
        `[AI_PLACEHOLDER_LEAK] sid=${messageSid} conv=${sessionId} ${breakdown}`,
      );
    }

    return cleaned;
  }

  /**
   * Limita o número de emojis no texto a `max` ocorrências. Combina o
   * caractere pictográfico Unicode com o seletor de variação `\uFE0F`
   * (presente em emojis monocromáticos como "ℹ️") para garantir que
   * ambos sumam juntos.
   */
  limitEmojis(text: string, max: number): string {
    if (!text) return text;
    const emojiRegex = /[\p{Extended_Pictographic}](\uFE0F)?/gu;
    let count = 0;
    return text.replace(emojiRegex, (match) => {
      count += 1;
      return count <= max ? match : '';
    });
  }

  /**
   * Limpa artefatos deixados pela remoção de emojis: espaços duplicados,
   * espaços antes de pontuação e indentação inicial. Sem isso, frases
   * como "Pronto ✅ tudo certo." viravam "Pronto  tudo certo." após
   * `limitEmojis(0)`, o que parecia um erro de formatação.
   */
  cleanEmojiArtifacts(text: string): string {
    if (!text) return text;
    return text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/(^|\n)[ \t]+/g, '$1');
  }

  /**
   * Detecta blocos consecutivos de linhas-lista (bullet ou numerada) e
   * converte em opções numeradas no padrão "1 - texto". Útil para o LLM
   * que adora produzir listas Markdown com `•` ou `-`.
   */
  convertListLinesToOptions(lines: string[]): string[] {
    const result: string[] = [];
    let index = 0;

    while (index < lines.length) {
      if (!this.isListLine(lines[index])) {
        result.push(lines[index]);
        index += 1;
        continue;
      }

      const blockItems: string[] = [];
      while (index < lines.length && this.isListLine(lines[index])) {
        const item = this.extractListLineContent(lines[index]);
        if (item) blockItems.push(item);
        index += 1;
      }

      blockItems.forEach((item, idx) => {
        result.push(`${idx + 1} - ${item}`);
      });
    }

    return result;
  }

  isListLine(line: string): boolean {
    if (!line) return false;
    return /^(?:•\s+|\d{1,2}[).-]\s+)/.test(line);
  }

  extractListLineContent(line: string): string {
    return line
      .replace(/^•\s+/, '')
      .replace(/^\d{1,2}[).-]\s+/, '')
      .trim();
  }
}
