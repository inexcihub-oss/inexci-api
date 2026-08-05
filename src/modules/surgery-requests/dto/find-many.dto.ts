import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManySurgeryRequestDto extends FindManySharedDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'all' || !value) return undefined;
    return value.split(',').map((item: string) => parseInt(item));
  })
  status?: number[];

  /**
   * Restringe a listagem às solicitações de um paciente. Usado pela aba
   * Histórico do atendimento e pela página de detalhe do paciente, que antes
   * baixavam todas as SCs da conta e filtravam em memória.
   */
  @IsOptional()
  @IsUUID()
  patientId?: string;

  /** Restringe a listagem às solicitações de um hospital. */
  @IsOptional()
  @IsUUID()
  hospitalId?: string;

  /** Restringe a listagem às solicitações de um convênio. */
  @IsOptional()
  @IsUUID()
  healthPlanId?: string;

  /**
   * Restringe a listagem às solicitações de um médico. Só estreita o escopo:
   * um médico fora dos acessíveis ao usuário devolve lista vazia.
   */
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
