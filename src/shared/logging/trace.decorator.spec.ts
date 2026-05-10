import { Logger as NestLogger } from '@nestjs/common';
import { LogTrace, traceInstanceMethods } from './trace.decorator';

describe('LogTrace + traceInstanceMethods', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(NestLogger.prototype, 'log')
      .mockImplementation(() => {});
    errorSpy = jest
      .spyOn(NestLogger.prototype, 'error')
      .mockImplementation(() => {});
    debugSpy = jest
      .spyOn(NestLogger.prototype, 'debug')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('@LogTrace() em classe', () => {
    @LogTrace()
    class FooService {
      sum(a: number, b: number): number {
        return a + b;
      }

      async asyncOk(): Promise<string> {
        return 'ok';
      }

      async asyncFail(): Promise<never> {
        throw new Error('boom');
      }

      _privado() {
        return 'oculto';
      }
    }

    it('loga enter e exit para método síncrono', () => {
      const svc = new FooService();
      expect(svc.sum(2, 3)).toBe(5);
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toBe('→ FooService.sum');
      expect(logSpy.mock.calls[1][0]).toMatch(/^← FooService\.sum \(\d+ms\)$/);
    });

    it('loga enter e exit para Promise resolvida', async () => {
      const svc = new FooService();
      await expect(svc.asyncOk()).resolves.toBe('ok');
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toBe('→ FooService.asyncOk');
      expect(logSpy.mock.calls[1][0]).toMatch(
        /^← FooService\.asyncOk \(\d+ms\)$/,
      );
    });

    it('loga ✗ no error e re-emite a exceção em Promise rejeitada', async () => {
      const svc = new FooService();
      await expect(svc.asyncFail()).rejects.toThrow('boom');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toMatch(
        /^✗ FooService\.asyncFail \(\d+ms\) — boom$/,
      );
    });

    it('métodos privados (_xxx) não são instrumentados', () => {
      const svc = new FooService();
      expect(svc._privado()).toBe('oculto');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('@LogTrace() em método único', () => {
    class Bar {
      @LogTrace()
      tracked() {
        return 'a';
      }

      naoTracked() {
        return 'b';
      }
    }

    it('apenas o método decorado é envolvido', () => {
      const bar = new Bar();
      bar.tracked();
      bar.naoTracked();
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toBe('→ Bar.tracked');
    });
  });

  describe('@LogTrace({ level: "debug" })', () => {
    @LogTrace({ level: 'debug' })
    class Quiet {
      run() {
        return true;
      }
    }

    it('emite em debug em vez de log', () => {
      const q = new Quiet();
      q.run();
      expect(logSpy).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('traceInstanceMethods cobre subclasses', () => {
    class Base {
      constructor() {
        traceInstanceMethods(this, { exclude: ['ignored'] });
      }

      baseMethod() {
        return 'base';
      }

      ignored() {
        return 'silenciado';
      }
    }

    class Child extends Base {
      childMethod() {
        return 'child';
      }

      baseMethod() {
        return 'overridden';
      }
    }

    it('envolve método herdado, sobrescrito e específico da subclasse', () => {
      const c = new Child();
      expect(c.childMethod()).toBe('child');
      expect(c.baseMethod()).toBe('overridden');

      const labels = logSpy.mock.calls.map((call) => call[0]);
      expect(labels).toEqual(
        expect.arrayContaining([
          '→ Child.childMethod',
          expect.stringMatching(/^← Child\.childMethod/),
          '→ Child.baseMethod',
          expect.stringMatching(/^← Child\.baseMethod/),
        ]),
      );
    });

    it('respeita exclude', () => {
      const c = new Child();
      logSpy.mockClear();
      expect(c.ignored()).toBe('silenciado');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('é idempotente — chamar duas vezes não duplica wrapping', () => {
      const c = new Child();
      traceInstanceMethods(c, { exclude: ['ignored'] });
      logSpy.mockClear();
      c.childMethod();
      expect(logSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('preserva valor de retorno e propaga argumentos', () => {
    class Calc {
      constructor() {
        traceInstanceMethods(this);
      }

      add(a: number, b: number) {
        return a + b;
      }
    }

    it('args chegam intactos e retorno é preservado', () => {
      const c = new Calc();
      expect(c.add(7, 8)).toBe(15);
    });
  });
});
