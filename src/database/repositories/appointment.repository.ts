import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Appointment, AppointmentStatus } from '../entities/appointment.entity';
import { BaseRepository } from './base.repository';

/** Recorte da agenda. Cada ponta da janela é opcional (lista aberta). */
export interface FindAgendaOptions {
  from?: Date;
  to?: Date;
  statuses?: AppointmentStatus[];
  order?: 'ASC' | 'DESC';
  take: number;
}

/**
 * O que a agenda precisa do paciente: o nome do card. Nada mais.
 *
 * A agenda é liberada por `Permission.AGENDA`, que não implica acesso ao
 * prontuário — um `leftJoinAndSelect` aqui entrega CPF, endereço, nascimento e
 * `medicalNotes` de todo paciente da janela a quem só marca consulta. `Patient`
 * não tem `@Exclude` em campo nenhum, então a entidade inteira sai serializada.
 */
const COLUNAS_PACIENTE_NO_CARD = ['patient.id', 'patient.name'];

/**
 * O que a agenda precisa da clínica: id e nome. Seleção explícita pelo mesmo
 * motivo do paciente — `leftJoinAndSelect` entregaria CNPJ, endereço e a grade
 * inteira a quem só marca consulta.
 */
const COLUNAS_CLINICA_NO_CARD = ['clinic.id', 'clinic.name'];

@Injectable()
export class AppointmentRepository extends BaseRepository<Appointment> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Appointment));
  }

  /**
   * Consultas de um conjunto de médicos, opcionalmente recortadas por janela de
   * datas e status. Traz o paciente para montar o card sem N+1.
   *
   * A janela é semiaberta (`>= from`, `< to`) e cada ponta pode ser omitida:
   * a agenda passa as duas, "Próximas" passa só `from` e "Realizadas" nenhuma.
   */
  async findAgenda(
    ownerId: string,
    doctorIds: string[],
    options: FindAgendaOptions,
  ): Promise<{ records: Appointment[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('appointment')
      // `withDeleted()` PRECISA vir ANTES dos joins. O TypeORM decide se anexa
      // `deleted_at IS NULL` à condição do join no instante em que `leftJoin`
      // é chamado, lendo o flag naquele momento (0.3.28,
      // `SelectQueryBuilder.join`). Chamado depois, o flag ainda vale para o
      // root, mas o join da clínica já saiu com o filtro fixado — e a clínica
      // excluída, que o soft delete existe justamente para preservar no
      // histórico, volta como `null`.
      .withDeleted()
      // Condição própria no join do paciente: o `withDeleted()` acima vale
      // para a query inteira e, de carona, reexibiria o nome de paciente
      // soft-deletado. A assimetria é proposital — só o paciente tem a
      // condição; a clínica deve mesmo voltar mesmo excluída.
      .leftJoin('appointment.patient', 'patient', 'patient.deleted_at IS NULL')
      .addSelect(COLUNAS_PACIENTE_NO_CARD)
      .leftJoin('appointment.clinic', 'clinic')
      .addSelect(COLUNAS_CLINICA_NO_CARD)
      .where('appointment.ownerId = :ownerId', { ownerId })
      .andWhere('appointment.doctorId IN (:...doctorIds)', { doctorIds })
      // `withDeleted()` desliga o filtro de soft delete do root também, então
      // ele volta na mão aqui — senão consulta excluída entra na agenda.
      //
      // Importante: este `andWhere` precisa vir DEPOIS do `.where()` acima —
      // `.where()` limpa (`expressionMap.wheres = []`) qualquer condição
      // adicionada antes dele, então um `andWhere` colocado antes seria
      // descartado em silêncio e o filtro nunca chegaria ao SQL gerado.
      .andWhere('appointment.deletedAt IS NULL');

    if (options.from) {
      qb.andWhere('appointment.scheduledAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('appointment.scheduledAt < :to', { to: options.to });
    }
    if (options.statuses?.length) {
      qb.andWhere('appointment.status IN (:...statuses)', {
        statuses: options.statuses,
      });
    }

    // `getManyAndCount` aplica o `take` só às linhas; a contagem é a do
    // recorte inteiro. É o que permite ao consumidor saber que a lista veio
    // cortada pelo teto — antes o `total` era o tamanho da página, ou seja,
    // igual ao teto, e o corte passava despercebido.
    const [records, total] = await qb
      .orderBy('appointment.scheduledAt', options.order ?? 'ASC')
      .take(options.take)
      .getManyAndCount();

    return { records, total };
  }

  /**
   * Histórico completo de consultas de um paciente (sem janela de data),
   * escopado à clínica e aos médicos acessíveis. Alimenta a aba "Consultas" e a
   * timeline.
   */
  findByPatient(
    ownerId: string,
    doctorIds: string[],
    patientId: string,
  ): Promise<Appointment[]> {
    return (
      this.repository
        .createQueryBuilder('appointment')
        // `withDeleted()` PRECISA vir ANTES dos joins. O TypeORM decide se anexa
        // `deleted_at IS NULL` à condição do join no instante em que `leftJoin`
        // é chamado, lendo o flag naquele momento (0.3.28,
        // `SelectQueryBuilder.join`). Chamado depois, o flag ainda vale para o
        // root, mas o join da clínica já saiu com o filtro fixado — e a clínica
        // excluída, que o soft delete existe justamente para preservar no
        // histórico, volta como `null`.
        .withDeleted()
        // Mesma assimetria proposital de `findAgenda`: condição de soft
        // delete no join do paciente, clínica sem condição própria.
        .leftJoin(
          'appointment.patient',
          'patient',
          'patient.deleted_at IS NULL',
        )
        .addSelect(COLUNAS_PACIENTE_NO_CARD)
        .leftJoin('appointment.clinic', 'clinic')
        .addSelect(COLUNAS_CLINICA_NO_CARD)
        .where('appointment.ownerId = :ownerId', { ownerId })
        .andWhere('appointment.doctorId IN (:...doctorIds)', { doctorIds })
        .andWhere('appointment.patientId = :patientId', { patientId })
        // Mesmo motivo de `findAgenda`: `andWhere` depois do `.where()` acima,
        // senão `.where()` limpa a condição e a consulta excluída volta na lista.
        .andWhere('appointment.deletedAt IS NULL')
        .orderBy('appointment.scheduledAt', 'DESC')
        .getMany()
    );
  }

  /**
   * Consulta por id com paciente e clínica. Serve tanto a leitura da tela
   * quanto os caminhos de mutação — o root vem completo; os joins só limitam
   * as colunas das relações.
   */
  findOneComRelacoes(id: string): Promise<Appointment | null> {
    return (
      this.repository
        .createQueryBuilder('appointment')
        // `withDeleted()` PRECISA vir ANTES dos joins. O TypeORM decide se anexa
        // `deleted_at IS NULL` à condição do join no instante em que `leftJoin`
        // é chamado, lendo o flag naquele momento (0.3.28,
        // `SelectQueryBuilder.join`). Chamado depois, o flag ainda vale para o
        // root, mas o join da clínica já saiu com o filtro fixado — e a clínica
        // excluída, que o soft delete existe justamente para preservar no
        // histórico, volta como `null`.
        .withDeleted()
        // Mesma assimetria proposital de `findAgenda`: condição de soft
        // delete no join do paciente, clínica sem condição própria.
        .leftJoin(
          'appointment.patient',
          'patient',
          'patient.deleted_at IS NULL',
        )
        .addSelect(COLUNAS_PACIENTE_NO_CARD)
        .leftJoin('appointment.clinic', 'clinic')
        .addSelect(COLUNAS_CLINICA_NO_CARD)
        .where('appointment.id = :id', { id })
        .andWhere('appointment.deletedAt IS NULL')
        .getOne()
    );
  }

  /**
   * Detecta conflito de horário para um médico: uma consulta ativa (não
   * cancelada) cujo intervalo [scheduled_at, scheduled_at + duração) sobrepõe
   * [start, end). `excludeId` ignora a própria consulta ao reagendar.
   */
  async hasOverlap(
    doctorId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('appointment')
      .where('appointment.doctorId = :doctorId', { doctorId })
      .andWhere('appointment.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('appointment.scheduledAt < :end', { end })
      .andWhere(
        `appointment.scheduledAt + (appointment.durationMinutes * interval '1 minute') > :start`,
        { start },
      );

    if (excludeId) {
      qb.andWhere('appointment.id != :excludeId', { excludeId });
    }

    const count = await qb.getCount();
    return count > 0;
  }

  /**
   * Consultas ativas (agendada/confirmada) que começam na janela [now, until]
   * e ainda não tiveram lembrete enviado. Base do lembrete automático de 24h.
   */
  findDueForReminder(now: Date, until: Date): Promise<Appointment[]> {
    return this.repository
      .createQueryBuilder('appointment')
      .where('appointment.reminderSentAt IS NULL')
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: ['scheduled', 'confirmed'],
      })
      .andWhere('appointment.scheduledAt BETWEEN :now AND :until', {
        now,
        until,
      })
      .orderBy('appointment.scheduledAt', 'ASC')
      .getMany();
  }
}
