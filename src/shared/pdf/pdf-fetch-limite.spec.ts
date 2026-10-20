import { EventEmitter } from 'events';
import { lerCorpoComLimite } from './pdf.service';

function fakes(headers: Record<string, string> = {}) {
  const res = Object.assign(new EventEmitter(), {
    headers,
    destroy: jest.fn(),
  });
  const req = { destroy: jest.fn() };
  return { req, res };
}

describe('lerCorpoComLimite', () => {
  it('devolve o corpo quando fica dentro do limite', () => {
    const { req, res } = fakes();
    const concluir = jest.fn();
    lerCorpoComLimite(req as any, res as any, 10, concluir);

    res.emit('data', Buffer.from('abc'));
    res.emit('data', Buffer.from('def'));
    res.emit('end');

    expect(concluir).toHaveBeenCalledWith(Buffer.from('abcdef'), undefined);
    expect(req.destroy).not.toHaveBeenCalled();
  });

  it('aborta o stream assim que passa do limite', () => {
    const { req, res } = fakes();
    const concluir = jest.fn();
    lerCorpoComLimite(req as any, res as any, 5, concluir);

    res.emit('data', Buffer.from('abcd'));
    res.emit('data', Buffer.from('efgh'));
    res.emit('data', Buffer.from('ijkl'));
    res.emit('end');

    expect(concluir).toHaveBeenCalledTimes(1);
    expect(concluir).toHaveBeenCalledWith(null, 'limite');
    expect(res.destroy).toHaveBeenCalled();
    expect(req.destroy).toHaveBeenCalled();
  });

  it('recusa de cara quando o content-length declarado excede o limite', () => {
    const { req, res } = fakes({ 'content-length': '999999' });
    const concluir = jest.fn();
    lerCorpoComLimite(req as any, res as any, 1000, concluir);

    expect(concluir).toHaveBeenCalledWith(null, 'limite');
    expect(req.destroy).toHaveBeenCalled();
  });

  it('erro no stream devolve null', () => {
    const { req, res } = fakes();
    const concluir = jest.fn();
    lerCorpoComLimite(req as any, res as any, 10, concluir);

    res.emit('error', new Error('reset'));

    expect(concluir).toHaveBeenCalledWith(null, 'erro');
  });
});
