import { BadRequestException } from '@nestjs/common';
import { JobIdPipe } from './job-id.pipe';

describe('JobIdPipe', () => {
  const pipe = new JobIdPipe();

  it('aceita ids numéricos e com prefixo', () => {
    expect(pipe.transform('123')).toBe('123');
    expect(pipe.transform('inbound:SM123abc')).toBe('inbound:SM123abc');
  });

  it('recusa caracteres fora do padrão', () => {
    expect(() => pipe.transform('a/b')).toThrow(BadRequestException);
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });
});
