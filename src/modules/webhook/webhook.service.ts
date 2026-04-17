import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRequest } from 'twilio';

@Injectable()
export class WebhookService {
  constructor(private readonly configService: ConfigService) {}

  validateTwilioSignature(
    signature: string,
    url: string,
    body: Record<string, any>,
  ): void {
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN', '');
    if (!authToken) return; // Em dev sem auth token configurado, pula validação

    const isValid = validateRequest(authToken, signature, url, body);
    if (!isValid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }
  }
}
