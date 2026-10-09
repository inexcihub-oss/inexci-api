import {
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

export function translateServiceError(err: unknown): string {
  if (err instanceof ConflictException) {
    const response = err.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      const msg = (response as any).message;
      if (typeof msg === 'string') return msg;
    }
    return 'Já existe um registro com esses dados.';
  }

  if (err instanceof BadRequestException) {
    const response = err.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      const msg = (response as any).message;
      if (Array.isArray(msg)) return msg.join('; ');
      if (typeof msg === 'string') return msg;
    }
    return 'Dados inválidos.';
  }

  if (err instanceof NotFoundException) {
    const response = err.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      const msg = (response as any).message;
      if (typeof msg === 'string') return msg;
    }
    return 'Registro não encontrado.';
  }

  if (err instanceof Error) {
    return err.message || 'Erro desconhecido.';
  }

  return 'Erro inesperado ao processar a solicitação.';
}
