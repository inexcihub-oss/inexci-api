import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { BillingRequiredException } from '../../modules/billing/billing.exceptions';

interface RespostaCapturada {
  status: number;
  body: Record<string, unknown>;
}

function criarHost(
  url = '/surgery-requests/abc/send',
  method = 'POST',
): {
  host: ArgumentsHost;
  capturado: RespostaCapturada;
} {
  const capturado: RespostaCapturada = { status: 0, body: {} };
  const response = {
    status(code: number) {
      capturado.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      capturado.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url, method }),
    }),
  } as unknown as ArgumentsHost;

  return { host, capturado };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  describe('propagação de campos extras do corpo da exceção', () => {
    it('preserva o `reason` do BillingRequiredException (cota atingida)', () => {
      const { host, capturado } = criarHost();

      filter.catch(
        new BillingRequiredException(
          'Você atingiu o limite de 20 solicitações do seu plano neste ciclo.',
          'quota_exceeded',
        ),
        host,
      );

      expect(capturado.status).toBe(HttpStatus.PAYMENT_REQUIRED);
      expect(capturado.body.reason).toBe('quota_exceeded');
      expect(capturado.body.message).toBe(
        'Você atingiu o limite de 20 solicitações do seu plano neste ciclo.',
      );
    });

    it.each([
      'subscription_suspended',
      'subscription_canceled',
      'trial_expired',
      'payment_method_required',
    ] as const)('preserva o reason "%s"', (reason) => {
      const { host, capturado } = criarHost();

      filter.catch(new BillingRequiredException('Bloqueado.', reason), host);

      expect(capturado.status).toBe(HttpStatus.PAYMENT_REQUIRED);
      expect(capturado.body.reason).toBe(reason);
    });

    it('preserva o `pendencies[]` dos bloqueios de transição de status', () => {
      const { host, capturado } = criarHost();

      filter.catch(
        new BadRequestException({
          message: 'Não é possível avançar.',
          pendencies: [
            { key: 'medical_report', name: 'Laudo' },
            { key: 'opme_items', name: 'OPME' },
          ],
        }),
        host,
      );

      expect(capturado.status).toBe(HttpStatus.BAD_REQUEST);
      expect(capturado.body.pendencies).toEqual([
        { key: 'medical_report', name: 'Laudo' },
        { key: 'opme_items', name: 'OPME' },
      ]);
      expect(capturado.body.message).toBe('Não é possível avançar.');
    });

    it('não deixa campo extra sobrescrever os campos reservados do filtro', () => {
      const { host, capturado } = criarHost('/rota-real');

      filter.catch(
        new BadRequestException({
          message: 'mensagem real',
          statusCode: 999,
          path: '/rota-falsa',
          timestamp: 'ontem',
          error: 'Bad Request',
        }),
        host,
      );

      expect(capturado.body.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(capturado.body.path).toBe('/rota-real');
      expect(capturado.body.timestamp).not.toBe('ontem');
      expect(capturado.body.error).toBeUndefined();
    });

    it('ignora chaves com valor undefined', () => {
      const { host, capturado } = criarHost();

      filter.catch(
        new BadRequestException({ message: 'erro', reason: undefined }),
        host,
      );

      expect('reason' in capturado.body).toBe(false);
    });
  });

  describe('comportamento preservado', () => {
    it('mantém o formato padrão para exceções com corpo string', () => {
      const { host, capturado } = criarHost();

      filter.catch(new NotFoundException('Recurso não encontrado'), host);

      expect(capturado.status).toBe(HttpStatus.NOT_FOUND);
      expect(capturado.body.message).toBe('Recurso não encontrado');
      expect(capturado.body.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(capturado.body.path).toBe('/surgery-requests/abc/send');
      expect(capturado.body.timestamp).toEqual(expect.any(String));
    });

    it('mantém 500 genérico para exceções não-HTTP', () => {
      const { host, capturado } = criarHost();

      filter.catch(new Error('boom'), host);

      expect(capturado.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(capturado.body.message).toBe('Erro interno do servidor');
    });

    it('mantém 500 genérico para erro com statusCode fora da faixa tratada', () => {
      const { host, capturado } = criarHost();
      const erro = Object.assign(new Error('boom'), { statusCode: 418 });

      filter.catch(erro, host);

      expect(capturado.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('mantém o `details` quando presente', () => {
      const { host, capturado } = criarHost();

      filter.catch(
        new BadRequestException({ message: 'erro', details: { campo: 'cpf' } }),
        host,
      );

      expect(capturado.body.details).toEqual({ campo: 'cpf' });
    });
  });

  /**
   * D-16: `POST /clinical-records` com ~1 MB de anamnese devolvia 500 "Erro
   * interno do servidor" e logava `Unhandled exception: PayloadTooLargeError`.
   * O erro nasce no `body-parser`, antes do Nest, então não é `HttpException`.
   */
  describe('corpo maior que o limite do body-parser', () => {
    /** Mesma forma do erro que o `raw-body` lança via `http-errors`. */
    function erroDoBodyParser() {
      return Object.assign(new Error('request entity too large'), {
        name: 'PayloadTooLargeError',
        type: 'entity.too.large',
        status: 413,
        statusCode: 413,
        expose: true,
        limit: 102400,
        length: 1048576,
      });
    }

    it('devolve 413 com mensagem em pt-BR em vez de 500', () => {
      const { host, capturado } = criarHost('/clinical-records');

      filter.catch(erroDoBodyParser(), host);

      expect(capturado.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(capturado.body.statusCode).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(capturado.body.message).toBe(
        'Conteúdo muito grande. Reduza o tamanho do texto ou do anexo.',
      );
    });

    it('mantém o formato padronizado da resposta de erro', () => {
      const { host, capturado } = criarHost('/clinical-records');

      filter.catch(erroDoBodyParser(), host);

      expect(capturado.body.path).toBe('/clinical-records');
      expect(capturado.body.timestamp).toEqual(expect.any(String));
    });

    it('não registra como "Unhandled exception"', () => {
      const { host } = criarHost('/clinical-records');
      const logger = (filter as unknown as { logger: Logger }).logger;
      const error = jest.spyOn(logger, 'error').mockImplementation();
      const warn = jest.spyOn(logger, 'warn').mockImplementation();

      filter.catch(erroDoBodyParser(), host);

      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('/clinical-records'),
      );

      error.mockRestore();
      warn.mockRestore();
    });

    it('reconhece o erro só pelo statusCode 413, sem o `type`', () => {
      const { host, capturado } = criarHost('/upload');

      filter.catch(
        Object.assign(new Error('too large'), { statusCode: 413 }),
        host,
      );

      expect(capturado.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    });
  });
});
