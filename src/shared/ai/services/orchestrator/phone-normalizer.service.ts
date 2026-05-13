import { Injectable } from '@nestjs/common';
import { User } from '../../../../database/entities/user.entity';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { maskPhone as maskPhoneUtil } from '../../../utils/mask.util';

export interface NormalizedInboundPhone {
  /**
   * Telefone canônico em formato internacional (`+55DDDNNNNNNNN`). Usado
   * sempre que precisamos representar o número de forma estável (cache key,
   * logs com hash, lookup primário).
   */
  canonicalPhone: string;
  /**
   * Lista de variações (com/sem +, com/sem 55, com/sem nono dígito,
   * formatadas com parênteses/hífen). Usada para casar usuários cadastrados
   * com formatos heterogêneos no banco.
   */
  lookupCandidates: string[];
}

/**
 * Normalização canônica de números brasileiros recebidos via WhatsApp e
 * lookup de usuário tolerante a formatos heterogêneos.
 *
 * - `normalizeInboundPhone`: tira o prefixo `whatsapp:`, força o DDI 55,
 *   gera variantes para o lookup.
 * - `buildPhoneLookupVariants` + `expandBrazilianLocalVariants`: produzem
 *   as combinações (com/sem nono dígito, formatos `(DD) XXXXX-XXXX`,
 *   `+55…`, etc.).
 * - `findUserByPhoneCandidates`: tenta cada variante no `UserRepository`
 *   na ordem em que foram geradas, devolvendo o primeiro hit. Como
 *   fallback, tenta o `primaryPhone` se ele não estiver na lista.
 * - `maskPhone`: máscara LGPD (T0/T25) reusando `shared/utils/mask.util`.
 *
 * Extraído do `AiOrchestratorService` na Fase 1 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`. A normalização é pura; o lookup
 * recebe `UserRepository` por DI (mockável em teste).
 */
@Injectable()
export class PhoneNormalizerService {
  constructor(private readonly userRepository: UserRepository) {}

  normalizeInboundPhone(rawFrom: string): NormalizedInboundPhone {
    const withoutPrefix = (rawFrom || '').replace(/^whatsapp:/i, '').trim();
    const digits = withoutPrefix.replace(/\D/g, '');

    if (!digits) {
      return {
        canonicalPhone: withoutPrefix,
        lookupCandidates: [withoutPrefix].filter(Boolean),
      };
    }

    const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
    const localWithoutCountry =
      withCountry.startsWith('55') && withCountry.length > 11
        ? withCountry.slice(2)
        : withCountry;

    const canonicalPhone = `+${withCountry}`;
    const formattedCandidates = this.buildPhoneLookupVariants(
      withCountry,
      localWithoutCountry,
    );

    const lookupCandidates = [
      canonicalPhone,
      withCountry,
      localWithoutCountry,
      withoutPrefix,
      ...formattedCandidates,
    ].filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );

    return { canonicalPhone, lookupCandidates };
  }

  async findUserByPhoneCandidates(
    primaryPhone: string,
    candidates: string[],
  ): Promise<User | null> {
    for (const candidate of candidates) {
      const user = await this.userRepository.findOneByPhone(candidate);
      if (user) return user;
    }

    if (!candidates.includes(primaryPhone)) {
      return this.userRepository.findOneByPhone(primaryPhone);
    }

    return null;
  }

  /**
   * Mascaramento de telefones para logs (LGPD — T0/T25). Delegado ao
   * helper compartilhado em `shared/utils/mask.util` para manter o formato
   * único em todo o backend.
   */
  maskPhone(phone: string): string {
    return maskPhoneUtil(phone);
  }

  /**
   * Gera variantes formatadas (com parênteses, hífen, espaços) e variantes
   * com/sem DDI 55. Usado para casar usuários cadastrados com diferentes
   * convenções de formatação no banco.
   */
  buildPhoneLookupVariants(
    withCountry: string,
    localWithoutCountry: string,
  ): string[] {
    const variants: string[] = [];

    const localDigits = (localWithoutCountry || '').replace(/\D/g, '');
    const localOptions = this.expandBrazilianLocalVariants(localDigits);

    for (const digits of localOptions) {
      if (digits.length === 11) {
        const ddd = digits.slice(0, 2);
        const first = digits.slice(2, 7);
        const last = digits.slice(7);
        variants.push(`(${ddd}) ${first}-${last}`);
        variants.push(`${ddd} ${first}-${last}`);
        variants.push(`${ddd}${first}-${last}`);
      }

      if (digits.length === 10) {
        const ddd = digits.slice(0, 2);
        const first = digits.slice(2, 6);
        const last = digits.slice(6);
        variants.push(`(${ddd}) ${first}-${last}`);
        variants.push(`${ddd} ${first}-${last}`);
        variants.push(`${ddd}${first}-${last}`);
      }

      variants.push(`+55${digits}`);
      variants.push(`55${digits}`);
      variants.push(digits);
    }

    return variants.filter(Boolean);
  }

  /**
   * Expande variações brasileiras do "nono dígito":
   *  - `31 8908-5791` → `31 9 8908-5791` (10 → 11 dígitos com 9 inserido)
   *  - `31 9 8908-5791` → `31 8908-5791` (11 → 10 dígitos sem o 9)
   * Útil porque o WhatsApp normaliza o nono dígito mas usuários antigos
   * podem ter sido cadastrados sem ele (e vice-versa).
   */
  expandBrazilianLocalVariants(localDigits: string): string[] {
    const variants = new Set<string>();
    if (!localDigits) return [];

    variants.add(localDigits);

    if (localDigits.length === 10) {
      variants.add(`${localDigits.slice(0, 2)}9${localDigits.slice(2)}`);
    }

    if (localDigits.length === 11 && localDigits[2] === '9') {
      variants.add(`${localDigits.slice(0, 2)}${localDigits.slice(3)}`);
    }

    return Array.from(variants);
  }
}
