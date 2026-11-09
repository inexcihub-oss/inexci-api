import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const COUPON_CODE_PATTERN = /^[A-Z0-9-]{3,40}$/;
export const COUPON_DURATIONS = ['once', 'repeating', 'forever'] as const;
export type CouponDuration = (typeof COUPON_DURATIONS)[number];
export const COUPON_MAX_DURATION_MONTHS = 36;
export const COUPON_MAX_PLANS = 20;
export const COUPON_SITUATIONS = [
  'ativo',
  'esgotado',
  'expirado',
  'desativado',
] as const;
export type CouponSituation = (typeof COUPON_SITUATIONS)[number];

interface CouponShape {
  percentOff?: unknown;
  amountOffCents?: unknown;
  duration?: unknown;
}

const isSet = (value: unknown): boolean =>
  value !== undefined && value !== null;

@ValidatorConstraint({ name: 'percentOffRule', async: false })
class PercentOffRule implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const o = args.object as CouponShape;
    if (isSet(value) === isSet(o.amountOffCents)) return false;
    if (!isSet(value)) return true;
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 1 &&
      value <= 100 &&
      Math.round(value * 100) / 100 === value
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const o = args.object as CouponShape;
    return isSet(args.value) === isSet(o.amountOffCents)
      ? 'Informe exatamente um entre percentOff e amountOffCents.'
      : 'percentOff deve estar entre 1 e 100, com até 2 casas decimais.';
  }
}

@ValidatorConstraint({ name: 'durationMonthsRule', async: false })
class DurationMonthsRule implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const o = args.object as CouponShape;
    if (o.duration === 'repeating') {
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= COUPON_MAX_DURATION_MONTHS
      );
    }
    return !isSet(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return (args.object as CouponShape).duration === 'repeating'
      ? `durationInMonths é obrigatório para duration "repeating" (inteiro de 1 a ${COUPON_MAX_DURATION_MONTHS}).`
      : 'durationInMonths só se aplica a duration "repeating".';
  }
}

@ValidatorConstraint({ name: 'futureDate', async: false })
class FutureDate implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const time = Date.parse(value);
    return !Number.isNaN(time) && time > Date.now();
  }

  defaultMessage(): string {
    return 'redeemBy precisa estar no futuro.';
  }
}

const normalizeCode = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateCouponDto {
  @ApiProperty({ example: 'MAIO20', pattern: COUPON_CODE_PATTERN.source })
  @Transform(normalizeCode)
  @Matches(COUPON_CODE_PATTERN, {
    message:
      'code deve ter de 3 a 40 caracteres entre A-Z, 0-9 e "-" (convertido para maiúsculas).',
  })
  code: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description: 'Desconto percentual. Exclusivo com amountOffCents.',
  })
  @Validate(PercentOffRule)
  percentOff?: number;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Desconto em centavos de BRL. Exclusivo com percentOff.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountOffCents?: number;

  @ApiProperty({ enum: COUPON_DURATIONS })
  @IsIn(COUPON_DURATIONS)
  duration: CouponDuration;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: COUPON_MAX_DURATION_MONTHS,
    description: 'Obrigatório (e só aceito) quando duration é "repeating".',
  })
  @Validate(DurationMonthsRule)
  durationInMonths?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional({
    type: String,
    example: '2026-12-31T23:59:59-03:00',
    description: 'Validade do código (ISO 8601), no futuro.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Validate(FutureDate)
  redeemBy?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Ids locais dos planos. A Stripe restringe por produto: todos os preços do mesmo produto entram. Vazio ou ausente vale para todos.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(COUPON_MAX_PLANS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  planIds?: string[];
}

export class CouponPlanDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class AdminCouponDto {
  @ApiProperty({ description: 'Id do código promocional na Stripe' })
  id: string;
  @ApiProperty() couponId: string;
  @ApiProperty() code: string;
  @ApiProperty({ type: Number, nullable: true }) percentOff: number | null;
  @ApiProperty({ type: Number, nullable: true }) amountOffCents: number | null;
  @ApiProperty({ type: String, nullable: true }) currency: string | null;
  @ApiProperty({ enum: COUPON_DURATIONS }) duration: CouponDuration;
  @ApiProperty({ type: Number, nullable: true })
  durationInMonths: number | null;
  @ApiProperty({ type: Number, nullable: true }) maxRedemptions: number | null;
  @ApiProperty() timesRedeemed: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt: Date | null;
  @ApiProperty() active: boolean;
  @ApiProperty() valid: boolean;
  @ApiProperty({ enum: COUPON_SITUATIONS }) situation: CouponSituation;
  @ApiProperty({
    description: 'true quando o cupom é restrito a produtos específicos',
  })
  restrictedToPlans: boolean;
  @ApiProperty({ type: [CouponPlanDto] }) plans: CouponPlanDto[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class AdminCouponListResponseDto {
  @ApiProperty({ type: [AdminCouponDto] }) items: AdminCouponDto[];
  @ApiProperty({
    description:
      'true quando a Stripe tem mais códigos do que o teto de 100 listados',
  })
  truncated: boolean;
}

export class AdminCouponActionResultDto {
  @ApiProperty() auditLogId: string;
  @ApiProperty({ type: AdminCouponDto }) coupon: AdminCouponDto;
}

export class AdminCouponRedemptionDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() ownerName: string;
  @ApiProperty() ownerEmail: string;
  @ApiProperty({ type: String, format: 'date-time' })
  firstInvoiceAt: Date;
  @ApiProperty() firstInvoiceId: string;
  @ApiProperty() invoicesCount: number;
  @ApiProperty({ description: 'Soma dos descontos das faturas, em centavos' })
  totalDiscountCents: number;
  @ApiProperty({ type: Number, nullable: true })
  currentDiscountPercentOff: number | null;
  @ApiProperty({ type: Number, nullable: true })
  currentDiscountAmountOffCents: number | null;
  @ApiProperty({ type: String, nullable: true })
  currentDiscountDuration: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  currentDiscountEndsAt: Date | null;
}

export class AdminCouponRedemptionsResponseDto {
  @ApiProperty() code: string;
  @ApiProperty() timesRedeemed: number;
  @ApiProperty({ type: [AdminCouponRedemptionDto] })
  items: AdminCouponRedemptionDto[];
}
