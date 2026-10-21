import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  RECEIVABLE_ATIVA_POR_CONSULTA,
  Receivable,
  ReceivableStatus,
} from 'src/database/entities/receivable.entity';
import { ReceivableItem } from 'src/database/entities/receivable-item.entity';
import {
  Appointment,
  AppointmentStatus,
} from 'src/database/entities/appointment.entity';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { PaymentRepository } from 'src/database/repositories/payment.repository';
import { ReceivableItemRepository } from 'src/database/repositories/receivable-item.repository';
import {
  FiltrosDeCobrancas,
  ReceivableRepository,
} from 'src/database/repositories/receivable.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { violouIndice } from 'src/database/repositories/unique-violation.util';
import { paginacao } from '../dto/finance-common.dto';
import {
  AppointmentFinanceStatusDto,
  CreateReceivableDto,
  FinanceProfessionalDto,
  FindReceivablesDto,
  PatientFinanceSummaryDto,
  ReceivableDetailDto,
  ReceivableItemInputDto,
  ReceivableListResponseDto,
} from '../dto/receivable.dto';
import {
  paraDetalhe,
  paraItemDaLista,
  saldoDevedor,
} from '../mappers/receivable.mapper';
import { dataEmSaoPaulo } from '../utils/datas';
import {
  cabeEmNumeric12x2,
  compararValores,
  LIMITE_NUMERIC_12_2_EM_CENTAVOS,
  multiplicar,
  normalizarValor,
  paraCentavos,
  somar,
  totalDoItem,
} from '../utils/dinheiro';
import { ROTULO_DO_TIPO_DE_CONSULTA } from '../utils/rotulos-financeiros';
import { statusDaCobranca } from '../utils/status-da-cobranca';

export const COBRANCA_NAO_ENCONTRADA = 'Cobrança não encontrada';
export const ITEM_NAO_ENCONTRADO = 'Item da cobrança não encontrado';
export const PACIENTE_NAO_ENCONTRADO = 'Paciente não encontrado';
export const CONSULTA_NAO_ENCONTRADA = 'Consulta não encontrada';
export const CONSULTA_DE_OUTRO_PACIENTE =
  'A consulta informada é de outro paciente';
export const EXECUTANTE_NAO_ENCONTRADO =
  'Profissional executante não encontrado';
export const EXECUTANTE_SEM_PERFIL =
  'O profissional executante precisa ter perfil profissional';
export const CONSULTA_JA_COBRADA = 'Esta consulta já tem uma cobrança ativa';
export const CONSULTA_DE_CONVENIO =
  'A consulta é de convênio. Confirme para cobrar mesmo assim';
export const COBRANCA_CANCELADA = 'A cobrança está cancelada';
export const COBRANCA_COM_PAGAMENTO =
  'Estorne os pagamentos antes de cancelar a cobrança';
export const ITEM_ABAIXO_DO_PAGO =
  'O total da cobrança ficaria menor que o valor já pago. Estorne o excedente antes';
export const ULTIMO_ITEM =
  'A cobrança precisa de ao menos um item. Cancele a cobrança em vez de remover o último item';
export const DESCONTO_ACIMA_DO_VALOR =
  'O desconto não pode passar do valor do item';
export const VALOR_FORA_DO_LIMITE = 'O valor da cobrança passa do limite';
export const CONSULTA_SEM_VALOR =
  'Informe o valor da consulta para gerar a cobrança';
export const CONSULTA_CANCELADA_NAO_COBRA =
  'Consulta cancelada não pode ser cobrada';
export const CONSULTA_SEM_COMPARECIMENTO_NAO_COBRA =
  'Consulta com falta do paciente não pode ser cobrada';

export const CODIGO_CONSULTA_DE_CONVENIO = 'CONSULTA_DE_CONVENIO';
export const CODIGO_CONSULTA_SEM_VALOR = 'CONSULTA_SEM_VALOR';
export const CODIGO_CONSULTA_CANCELADA = 'CONSULTA_CANCELADA';
export const CODIGO_CONSULTA_SEM_COMPARECIMENTO = 'CONSULTA_SEM_COMPARECIMENTO';

interface OpcoesDeCriacao {
  executantesConfiaveis?: string[];
}

export interface OpcoesDaCobrancaPelaConsulta {
  allowHealthPlan?: boolean;
  unitAmount?: string;
}

function recusa(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly receivableRepository: ReceivableRepository,
    private readonly itemRepository: ReceivableItemRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly patientRepository: PatientRepository,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async findAll(
    ownerId: string,
    dto: FindReceivablesDto,
  ): Promise<ReceivableListResponseDto> {
    const { page, limit, skip } = paginacao(dto);
    const filtros: FiltrosDeCobrancas = {
      status: dto.status,
      from: dto.from,
      to: dto.to,
      patientId: dto.patientId,
      executedById: dto.executedById,
    };
    const [[cobrancas, total], totalOpenAmount] = await Promise.all([
      this.receivableRepository.findPaged(ownerId, filtros, skip, limit),
      this.receivableRepository.sumOpenBalance(ownerId, filtros),
    ]);
    return {
      data: await this.paraLista(cobrancas),
      total,
      page,
      limit,
      totalOpenAmount: normalizarValor(totalOpenAmount),
    };
  }

  async findOne(ownerId: string, id: string): Promise<ReceivableDetailDto> {
    const cobranca = await this.receivableRepository.findDetail(id, ownerId);
    if (!cobranca) throw new NotFoundException(COBRANCA_NAO_ENCONTRADA);
    return paraDetalhe(cobranca);
  }

  async patientSummary(
    ownerId: string,
    patientId: string,
  ): Promise<PatientFinanceSummaryDto> {
    await this.assertPaciente(ownerId, patientId);
    const cobrancas = await this.receivableRepository.findByPatient(
      ownerId,
      patientId,
    );
    const emAberto = cobrancas
      .filter(
        (c) =>
          c.status === ReceivableStatus.OPEN ||
          c.status === ReceivableStatus.PARTIAL,
      )
      .map((c) => saldoDevedor(c));
    return {
      openAmount: somar(...emAberto),
      receivables: await this.paraLista(cobrancas),
    };
  }

  async professionals(ownerId: string): Promise<FinanceProfessionalDto[]> {
    const usuarios = await this.userRepository.findDoctorsByOwnerId(ownerId);
    return usuarios.map((usuario) => {
      const perfil = usuario.doctorProfile;
      const numero = perfil?.crm?.trim();
      const uf = perfil?.crmState?.trim();
      return {
        id: usuario.id,
        name: usuario.name,
        council: perfil?.council ?? '',
        registry: numero
          ? `${perfil?.council ?? ''} ${numero}${uf ? `/${uf}` : ''}`.trim()
          : null,
      };
    });
  }

  appointmentsStatus(
    ownerId: string,
    ids: string[],
  ): Promise<AppointmentFinanceStatusDto[]> {
    return this.receivableRepository.findActiveByAppointments(ownerId, [
      ...new Set(ids),
    ]);
  }

  async create(
    ownerId: string,
    userId: string,
    dto: CreateReceivableDto,
    opcoes: OpcoesDeCriacao = {},
  ): Promise<ReceivableDetailDto> {
    await this.assertPaciente(ownerId, dto.patientId);
    const consultas = new Set<string>();
    if (dto.appointmentId) consultas.add(dto.appointmentId);
    dto.items.forEach((item) => {
      if (item.appointmentId) consultas.add(item.appointmentId);
    });
    for (const appointmentId of consultas) {
      await this.assertConsulta(ownerId, appointmentId, dto.patientId);
    }
    await this.assertExecutantes(
      ownerId,
      dto.items,
      opcoes.executantesConfiaveis ?? [],
    );
    dto.items.forEach((item) => this.assertValorDoItem(item));
    if (
      !cabeEmNumeric12x2(somar(...dto.items.map((item) => totalDoItem(item))))
    ) {
      throw new BadRequestException(VALOR_FORA_DO_LIMITE);
    }

    if (dto.appointmentId) {
      await this.assertConsultaSemCobranca(ownerId, dto.appointmentId);
    }

    const referenceDate = dto.referenceDate ?? dataEmSaoPaulo(new Date());

    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const cobranca = await this.receivableRepository.insert(
          {
            ownerId,
            patientId: dto.patientId,
            appointmentId: dto.appointmentId ?? null,
            referenceDate,
            dueDate: dto.dueDate ?? null,
            notes: dto.notes ? dto.notes : null,
            totalAmount: '0.00',
            paidAmount: '0.00',
            status: ReceivableStatus.OPEN,
            createdById: userId,
          },
          manager,
        );
        await this.itemRepository.insertMany(
          dto.items.map((item) =>
            this.novoItem(ownerId, userId, cobranca.id, item, referenceDate),
          ),
          manager,
        );
        await this.recalcularTotais(cobranca, manager);
        return cobranca.id;
      });
      return this.findOne(ownerId, id);
    } catch (erro) {
      if (violouIndice(erro, RECEIVABLE_ATIVA_POR_CONSULTA)) {
        throw new ConflictException(CONSULTA_JA_COBRADA);
      }
      throw erro;
    }
  }

  async createFromAppointment(
    ownerId: string,
    userId: string,
    appointmentId: string,
    opcoes: OpcoesDaCobrancaPelaConsulta = {},
  ): Promise<ReceivableDetailDto> {
    const consulta = await this.appointmentRepository.findOne({
      id: appointmentId,
      ownerId,
    });
    if (!consulta) throw new NotFoundException(CONSULTA_NAO_ENCONTRADA);
    if (consulta.status === AppointmentStatus.CANCELLED) {
      throw recusa(CODIGO_CONSULTA_CANCELADA, CONSULTA_CANCELADA_NAO_COBRA);
    }
    if (consulta.status === AppointmentStatus.NO_SHOW) {
      throw recusa(
        CODIGO_CONSULTA_SEM_COMPARECIMENTO,
        CONSULTA_SEM_COMPARECIMENTO_NAO_COBRA,
      );
    }
    if (consulta.healthPlanId && !opcoes.allowHealthPlan) {
      throw recusa(CODIGO_CONSULTA_DE_CONVENIO, CONSULTA_DE_CONVENIO);
    }
    const valor = opcoes.unitAmount ?? consulta.price;
    if (valor === null || valor === undefined || valor === '') {
      throw recusa(CODIGO_CONSULTA_SEM_VALOR, CONSULTA_SEM_VALOR);
    }
    await this.assertConsultaSemCobranca(ownerId, appointmentId);

    const profissional = await this.userRepository.findOneWithProfile({
      id: consulta.doctorId,
      ownerId,
    });
    const data = dataEmSaoPaulo(new Date(consulta.scheduledAt));

    return this.create(
      ownerId,
      userId,
      {
        patientId: consulta.patientId,
        appointmentId,
        referenceDate: data,
        items: [
          {
            description: this.descricaoDaConsulta(consulta, profissional?.name),
            executedById: consulta.doctorId,
            executedAt: data,
            appointmentId,
            quantity: 1,
            unitAmount: normalizarValor(valor),
          },
        ],
      },
      { executantesConfiaveis: [consulta.doctorId] },
    );
  }

  async addItem(
    ownerId: string,
    userId: string,
    receivableId: string,
    item: ReceivableItemInputDto,
  ): Promise<ReceivableDetailDto> {
    const atual = await this.receivableRepository.findOwned(
      receivableId,
      ownerId,
    );
    if (!atual) throw new NotFoundException(COBRANCA_NAO_ENCONTRADA);
    if (item.appointmentId) {
      await this.assertConsulta(ownerId, item.appointmentId, atual.patientId);
    }
    await this.assertExecutantes(ownerId, [item], []);
    this.assertValorDoItem(item);

    await this.dataSource.transaction(async (manager) => {
      const cobranca = await this.travar(ownerId, receivableId, manager);
      this.assertNaoCancelada(cobranca);
      const atualAtivo = await this.itemRepository.sumActiveTotal(
        cobranca.id,
        manager,
      );
      if (!cabeEmNumeric12x2(somar(atualAtivo, totalDoItem(item)))) {
        throw new BadRequestException(VALOR_FORA_DO_LIMITE);
      }
      await this.itemRepository.insertMany(
        [
          this.novoItem(
            ownerId,
            userId,
            cobranca.id,
            item,
            cobranca.referenceDate,
          ),
        ],
        manager,
      );
      await this.recalcularTotais(cobranca, manager);
    });
    return this.findOne(ownerId, receivableId);
  }

  async cancelItem(
    ownerId: string,
    userId: string,
    receivableId: string,
    itemId: string,
  ): Promise<ReceivableDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const cobranca = await this.travar(ownerId, receivableId, manager);
      this.assertNaoCancelada(cobranca);
      const item = await this.itemRepository.findActiveOfReceivable(
        itemId,
        cobranca.id,
        manager,
      );
      if (!item) throw new NotFoundException(ITEM_NAO_ENCONTRADO);
      if ((await this.itemRepository.countActive(cobranca.id, manager)) <= 1) {
        throw new BadRequestException(ULTIMO_ITEM);
      }
      const novoTotal = await this.itemRepository.sumActiveTotal(
        cobranca.id,
        manager,
        item.id,
      );
      const pago = await this.paymentRepository.sumNetPaid(
        cobranca.id,
        manager,
      );
      if (compararValores(pago, novoTotal) > 0) {
        throw new BadRequestException(ITEM_ABAIXO_DO_PAGO);
      }
      await this.itemRepository.markCancelled(item.id, userId, manager);
      await this.recalcularTotais(cobranca, manager);
    });
    return this.findOne(ownerId, receivableId);
  }

  async cancel(
    ownerId: string,
    userId: string,
    receivableId: string,
    reason: string,
  ): Promise<ReceivableDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const cobranca = await this.travar(ownerId, receivableId, manager);
      this.assertNaoCancelada(cobranca);
      const pago = await this.paymentRepository.sumNetPaid(
        cobranca.id,
        manager,
      );
      if (paraCentavos(pago) !== 0) {
        throw new BadRequestException(COBRANCA_COM_PAGAMENTO);
      }
      await this.receivableRepository.markCancelled(
        cobranca.id,
        {
          cancelledById: userId,
          cancelReason: reason,
          cancelledAt: new Date(),
        },
        manager,
      );
    });
    return this.findOne(ownerId, receivableId);
  }

  async travar(
    ownerId: string,
    receivableId: string,
    manager: EntityManager,
  ): Promise<Receivable> {
    const cobranca = await this.receivableRepository.lockOwned(
      receivableId,
      ownerId,
      manager,
    );
    if (!cobranca) throw new NotFoundException(COBRANCA_NAO_ENCONTRADA);
    return cobranca;
  }

  async recalcularTotais(
    cobranca: Receivable,
    manager: EntityManager,
  ): Promise<void> {
    const totalAmount = normalizarValor(
      await this.itemRepository.sumActiveTotal(cobranca.id, manager),
    );
    const paidAmount = normalizarValor(
      await this.paymentRepository.sumNetPaid(cobranca.id, manager),
    );
    const status = statusDaCobranca({
      totalAmount,
      paidAmount,
      cancelledAt: cobranca.cancelledAt,
    });
    await this.receivableRepository.updateTotals(
      cobranca.id,
      { totalAmount, paidAmount, status },
      manager,
    );
    cobranca.totalAmount = totalAmount;
    cobranca.paidAmount = paidAmount;
    cobranca.status = status;
  }

  assertNaoCancelada(cobranca: Receivable): void {
    if (
      cobranca.cancelledAt ||
      cobranca.status === ReceivableStatus.CANCELLED
    ) {
      throw new BadRequestException(COBRANCA_CANCELADA);
    }
  }

  private async paraLista(cobrancas: Receivable[]) {
    const descricoes = await this.itemRepository.activeDescriptions(
      cobrancas.map((c) => c.id),
    );
    return cobrancas.map((c) => paraItemDaLista(c, descricoes.get(c.id) ?? ''));
  }

  private descricaoDaConsulta(
    consulta: Appointment,
    profissional: string | undefined,
  ): string {
    const rotulo = ROTULO_DO_TIPO_DE_CONSULTA[consulta.type] ?? 'Consulta';
    const texto = profissional ? `${rotulo} - ${profissional}` : rotulo;
    return texto.slice(0, 150);
  }

  private novoItem(
    ownerId: string,
    userId: string,
    receivableId: string,
    item: ReceivableItemInputDto,
    dataPadrao: string,
  ): Partial<ReceivableItem> {
    const quantity = item.quantity ?? 1;
    const unitAmount = normalizarValor(item.unitAmount);
    const discount = normalizarValor(item.discount ?? '0');
    const surcharge = normalizarValor(item.surcharge ?? '0');
    return {
      ownerId,
      receivableId,
      createdById: userId,
      description: item.description,
      executedById: item.executedById ?? null,
      executedAt: item.executedAt ?? dataPadrao,
      appointmentId: item.appointmentId ?? null,
      quantity,
      unitAmount,
      discount,
      surcharge,
      total: totalDoItem({ unitAmount, quantity, discount, surcharge }),
    };
  }

  private assertValorDoItem(item: ReceivableItemInputDto): void {
    const bruto = paraCentavos(
      multiplicar(item.unitAmount, item.quantity ?? 1),
    );
    const total =
      bruto - paraCentavos(item.discount) + paraCentavos(item.surcharge);
    if (total < 0) throw new BadRequestException(DESCONTO_ACIMA_DO_VALOR);
    if (
      bruto > LIMITE_NUMERIC_12_2_EM_CENTAVOS ||
      total > LIMITE_NUMERIC_12_2_EM_CENTAVOS
    ) {
      throw new BadRequestException(VALOR_FORA_DO_LIMITE);
    }
  }

  private async assertPaciente(
    ownerId: string,
    patientId: string,
  ): Promise<void> {
    const paciente = await this.patientRepository.findOne({
      id: patientId,
      ownerId,
    });
    if (!paciente) throw new NotFoundException(PACIENTE_NAO_ENCONTRADO);
  }

  private async assertConsulta(
    ownerId: string,
    appointmentId: string,
    patientId: string,
  ): Promise<void> {
    const consulta = await this.appointmentRepository.findOne({
      id: appointmentId,
      ownerId,
    });
    if (!consulta) throw new NotFoundException(CONSULTA_NAO_ENCONTRADA);
    if (consulta.patientId !== patientId) {
      throw new BadRequestException(CONSULTA_DE_OUTRO_PACIENTE);
    }
  }

  private async assertConsultaSemCobranca(
    ownerId: string,
    appointmentId: string,
  ): Promise<void> {
    const ativas = await this.receivableRepository.findActiveByAppointments(
      ownerId,
      [appointmentId],
    );
    if (ativas.length > 0) throw new ConflictException(CONSULTA_JA_COBRADA);
  }

  private async assertExecutantes(
    ownerId: string,
    itens: ReceivableItemInputDto[],
    confiaveis: string[],
  ): Promise<void> {
    const ids = new Set(
      itens
        .map((item) => item.executedById)
        .filter((id): id is string => !!id && !confiaveis.includes(id)),
    );
    for (const id of ids) {
      const usuario = await this.userRepository.findOneWithProfile({
        id,
        ownerId,
      });
      if (!usuario) throw new NotFoundException(EXECUTANTE_NAO_ENCONTRADO);
      if (!usuario.doctorProfile) {
        throw new BadRequestException(EXECUTANTE_SEM_PERFIL);
      }
    }
  }
}
