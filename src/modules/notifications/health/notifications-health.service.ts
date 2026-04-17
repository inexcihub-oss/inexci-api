import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import * as net from 'net';

@Injectable()
export class NotificationsHealthService extends HealthIndicator {
  private readonly logger = new Logger(NotificationsHealthService.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  /**
   * Verifica conexão Redis (filas Bull)
   */
  async checkRedis(): Promise<HealthIndicatorResult> {
    const host = this.config.get<string>('REDIS_HOST', 'localhost');
    const port = this.config.get<number>('REDIS_PORT', 6379);

    try {
      await this.checkTcpConnection(host, port, 3000);
      return this.getStatus('redis', true, { host, port });
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${error}`);
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus('redis', false, { host, port, error: String(error) }),
      );
    }
  }

  /**
   * Verifica conexão SMTP (handshake)
   */
  async checkSmtp(): Promise<HealthIndicatorResult> {
    const host = this.config.get<string>('MAIL_HOST', 'smtp.example.com');
    const port = this.config.get<number>('MAIL_PORT', 587);

    try {
      await this.checkTcpConnection(host, port, 5000);
      return this.getStatus('smtp', true, { host, port });
    } catch (error) {
      this.logger.warn(`SMTP health check failed: ${error}`);
      throw new HealthCheckError(
        'SMTP check failed',
        this.getStatus('smtp', false, { host, port, error: String(error) }),
      );
    }
  }

  /**
   * Verifica credenciais Twilio (presença das variáveis)
   */
  async checkTwilio(): Promise<HealthIndicatorResult> {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = this.config.get<string>('TWILIO_WHATSAPP_FROM');

    const configured = !!accountSid && !!authToken && !!fromNumber;

    if (configured) {
      return this.getStatus('twilio', true, { configured: true });
    }

    throw new HealthCheckError(
      'Twilio credentials missing',
      this.getStatus('twilio', false, {
        configured: false,
        missing: [
          !accountSid && 'TWILIO_ACCOUNT_SID',
          !authToken && 'TWILIO_AUTH_TOKEN',
          !fromNumber && 'TWILIO_WHATSAPP_FROM',
        ].filter(Boolean),
      }),
    );
  }

  private checkTcpConnection(
    host: string,
    port: number,
    timeout: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${host}:${port}`));
      });
      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });
      socket.connect(port, host);
    });
  }
}
