import { Logger as NestLogger } from '@nestjs/common';

const TRACE_LOGGER = new NestLogger('Trace');

const TRACED = Symbol.for('inexci.logging.traced');

export interface LogTraceOptions {
  level?: 'log' | 'debug';
  label?: string;
  exclude?: string[];
}

export function LogTrace(options: LogTraceOptions = {}): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): any {
    if (descriptor && propertyKey !== undefined) {
      const className =
        options.label ?? target?.constructor?.name ?? 'Anonymous';
      wrapDescriptor(
        descriptor,
        `${className}.${String(propertyKey)}`,
        options,
      );
      return descriptor;
    }

    const ctor = target as new (...args: unknown[]) => unknown;
    const proto = ctor.prototype;
    const className = options.label ?? ctor.name;
    const exclude = new Set(options.exclude ?? []);

    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      if (key.startsWith('_')) continue;
      if (exclude.has(key)) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (!desc || typeof desc.value !== 'function') continue;
      wrapDescriptor(desc, `${className}.${key}`, options);
      Object.defineProperty(proto, key, desc);
    }
    return target;
  };
}

export function traceInstanceMethods(
  instance: object,
  options: LogTraceOptions = {},
): void {
  if ((instance as any)[TRACED]) return;
  Object.defineProperty(instance, TRACED, {
    value: true,
    enumerable: false,
    writable: false,
  });

  const className = options.label ?? instance.constructor.name;
  const exclude = new Set(options.exclude ?? []);
  const methods = collectMethods(instance);

  for (const name of methods) {
    if (exclude.has(name)) continue;
    if (name.startsWith('_')) continue;
    const original = (instance as any)[name];
    if (typeof original !== 'function') continue;

    const wrapped = createTracer(
      original.bind(instance),
      `${className}.${name}`,
      options,
    );
    Object.defineProperty(instance, name, {
      value: wrapped,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

function collectMethods(instance: object): Set<string> {
  const methods = new Set<string>();
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc && typeof desc.value === 'function') {
        methods.add(key);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return methods;
}

function wrapDescriptor(
  descriptor: PropertyDescriptor,
  label: string,
  options: LogTraceOptions,
): void {
  const original = descriptor.value;
  if (typeof original !== 'function') return;
  if ((original as any)[TRACED]) return;

  const wrapped = function (this: unknown, ...args: unknown[]) {
    return runTraced(original.bind(this), label, args, options);
  };

  copyMetadata(original, wrapped);
  Object.defineProperty(wrapped, 'name', { value: original.name });
  Object.defineProperty(wrapped, TRACED, {
    value: true,
    enumerable: false,
    writable: false,
  });
  descriptor.value = wrapped;
}

function createTracer(
  fn: (...args: unknown[]) => unknown,
  label: string,
  options: LogTraceOptions,
): (...args: unknown[]) => unknown {
  const wrapped = function (...args: unknown[]) {
    return runTraced(fn, label, args, options);
  };
  copyMetadata(fn, wrapped);
  Object.defineProperty(wrapped, 'name', { value: fn.name || label });
  Object.defineProperty(wrapped, TRACED, {
    value: true,
    enumerable: false,
    writable: false,
  });
  return wrapped;
}

function runTraced(
  fn: (...args: unknown[]) => unknown,
  label: string,
  args: unknown[],
  options: LogTraceOptions,
): unknown {
  const level = options.level ?? 'log';
  const startedAt = Date.now();
  emit(level, `→ ${label}`);

  let result: unknown;
  try {
    result = fn(...args);
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    TRACE_LOGGER.error(`✗ ${label} (${elapsed}ms) — ${describeError(err)}`);
    throw err;
  }

  if (isPromise(result)) {
    return result.then(
      (value) => {
        emit(level, `← ${label} (${Date.now() - startedAt}ms)`);
        return value;
      },
      (err: unknown) => {
        TRACE_LOGGER.error(
          `✗ ${label} (${Date.now() - startedAt}ms) — ${describeError(err)}`,
        );
        throw err;
      },
    );
  }

  emit(level, `← ${label} (${Date.now() - startedAt}ms)`);
  return result;
}

function emit(level: 'log' | 'debug', message: string): void {
  if (level === 'debug') {
    TRACE_LOGGER.debug(message);
  } else {
    TRACE_LOGGER.log(message);
  }
}

function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as Promise<T>).then === 'function'
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function copyMetadata(from: object, to: object): void {
  const reflect = Reflect as unknown as {
    getMetadataKeys?: (target: object) => unknown[];
    getMetadata?: (key: unknown, target: object) => unknown;
    defineMetadata?: (key: unknown, value: unknown, target: object) => void;
  };
  if (
    !reflect.getMetadataKeys ||
    !reflect.getMetadata ||
    !reflect.defineMetadata
  ) {
    return;
  }
  for (const key of reflect.getMetadataKeys(from)) {
    reflect.defineMetadata(key, reflect.getMetadata(key, from), to);
  }
}
