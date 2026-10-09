import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { applyGlobalAppConfig } from './global-app-config';

describe('applyGlobalAppConfig', () => {
  const criarAppFake = () => ({
    useGlobalPipes: jest.fn(),
    useGlobalFilters: jest.fn(),
    useGlobalInterceptors: jest.fn(),
    get: jest.fn().mockReturnValue(new Reflector()),
  });

  it('registra o ValidationPipe com whitelist, forbidNonWhitelisted e transform', () => {
    const app = criarAppFake();

    applyGlobalAppConfig(app as any);

    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    const pipe = app.useGlobalPipes.mock.calls[0][0];
    expect(pipe).toBeInstanceOf(ValidationPipe);
    expect((pipe as any).validatorOptions).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect((pipe as any).transformOptions ?? {}).toBeDefined();
    expect((pipe as any).isTransformEnabled).toBe(true);
  });

  it('registra o AllExceptionsFilter', () => {
    const app = criarAppFake();

    applyGlobalAppConfig(app as any);

    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
    expect(app.useGlobalFilters.mock.calls[0][0]).toBeInstanceOf(
      AllExceptionsFilter,
    );
  });

  it('registra o ClassSerializerInterceptor com o Reflector da aplicação', () => {
    const app = criarAppFake();

    applyGlobalAppConfig(app as any);

    expect(app.get).toHaveBeenCalledWith(Reflector);
    expect(app.useGlobalInterceptors).toHaveBeenCalledTimes(1);
    expect(app.useGlobalInterceptors.mock.calls[0][0]).toBeInstanceOf(
      ClassSerializerInterceptor,
    );
  });
});
