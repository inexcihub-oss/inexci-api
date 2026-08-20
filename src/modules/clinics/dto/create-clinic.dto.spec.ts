import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClinicDto } from './create-clinic.dto';

async function erros(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateClinicDto, payload);
  const resultado = await validate(dto);
  return resultado.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateClinicDto', () => {
  it('aceita apenas o nome', async () => {
    expect(await erros({ name: 'Unidade Centro' })).toEqual([]);
  });

  it('exige o nome', async () => {
    const mensagens = await erros({});
    expect(mensagens.join(' ')).toContain('name');
  });

  it('aceita grade semanal válida', async () => {
    expect(
      await erros({
        name: 'Unidade Centro',
        businessHours: {
          mon: [
            { start: '08:00', end: '12:00' },
            { start: '14:00', end: '18:00' },
          ],
        },
      }),
    ).toEqual([]);
  });

  it('recusa grade com blocos sobrepostos, devolvendo a mensagem da regra', async () => {
    const mensagens = await erros({
      name: 'Unidade Centro',
      businessHours: {
        mon: [
          { start: '08:00', end: '12:00' },
          { start: '11:00', end: '15:00' },
        ],
      },
    });
    expect(mensagens).toContain('Há blocos de horário sobrepostos em "mon".');
  });

  it('recusa hora fora do formato HH:mm', async () => {
    const mensagens = await erros({
      name: 'Unidade Centro',
      businessHours: { mon: [{ start: '8h', end: '12:00' }] },
    });
    expect(mensagens).toContain(
      'Horário inválido em "mon": use o formato HH:mm.',
    );
  });

  it('recusa dia desconhecido', async () => {
    const mensagens = await erros({
      name: 'Unidade Centro',
      businessHours: { segunda: [] },
    });
    expect(mensagens).toContain(
      'Dia inválido na grade de horários: "segunda".',
    );
  });
});
