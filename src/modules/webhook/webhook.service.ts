import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRequest } from 'twilio';

@Injectable()
export class WebhookService {
  constructor(private readonly configService: ConfigService) {}

  validateTwilioSignature(
    signature: string,
    urls: string[],
    body: Record<string, any>,
  ): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const validateSignatureRaw = this.configService.get<string>(
      'TWILIO_VALIDATE_SIGNATURE',
      '',
    );
    const shouldValidateSignature =
      validateSignatureRaw.trim().toLowerCase() === 'true' ||
      validateSignatureRaw.trim() === '1' ||
      nodeEnv === 'production';

    if (!shouldValidateSignature) return;

    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN', '');
    if (!authToken) return; // Em dev sem auth token configurado, pula validação

    const isValid = urls.some((url) =>
      validateRequest(authToken, signature, url, body),
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }
  }
}
