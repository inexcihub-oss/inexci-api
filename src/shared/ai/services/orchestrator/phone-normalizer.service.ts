import { Injectable } from '@nestjs/common';
import { User } from '../../../../database/entities/user.entity';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { maskPhone as maskPhoneUtil } from '../../../utils/mask.util';

export interface NormalizedInboundPhone {
  canonicalPhone: string;
  lookupCandidates: string[];
}

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

  maskPhone(phone: string): string {
    return maskPhoneUtil(phone);
  }

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

  expandBrazilianLocalVariants(localDigits: string): string[] {
    const variants = new Set<string>();
    if (!localDigits) return [];

    variants.add(localDigits);

    if (
      localDigits.length === 10 &&
      ['6', '7', '8', '9'].includes(localDigits[2])
    ) {
      variants.add(`${localDigits.slice(0, 2)}9${localDigits.slice(2)}`);
    }

    if (localDigits.length === 11 && localDigits[2] === '9') {
      variants.add(`${localDigits.slice(0, 2)}${localDigits.slice(3)}`);
    }

    return Array.from(variants);
  }
}
