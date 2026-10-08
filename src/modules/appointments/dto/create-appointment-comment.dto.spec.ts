import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAppointmentCommentDto } from './create-appointment-comment.dto';

describe('CreateAppointmentCommentDto', () => {
  const transform = (content: unknown) =>
    plainToInstance(CreateAppointmentCommentDto, { content });

  it('apara o comentário', () => {
    const dto = transform('  ligou para confirmar  ');

    expect(dto.content).toBe('ligou para confirmar');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('recusa comentário só com espaços (400, não grava vazio)', () => {
    expect(validateSync(transform('   \n\t '))).not.toHaveLength(0);
  });
});
