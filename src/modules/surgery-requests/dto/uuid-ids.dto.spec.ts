import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDocumentDto } from '../documents/dto/create-document.dto';
import { DeleteDocumentDto } from '../documents/dto/delete-document.dto';
import {
  CreateSurgeryRequestProcedureDto,
  ProcedureItemDto,
} from '../procedures/dto/create-surgery-request-procedure.dto';
import {
  AuthorizeProcedureDto,
  AuthorizeProceduresDto,
} from '../procedures/dto/authorize-procedures.dto';
import { CreateOpmeDto } from '../opme/dto/create-opme.dto';
import { STORAGE_FOLDERS } from 'src/config/storage.config';

/**
 * Todas essas colunas são `uuid` no Postgres. Validadas como string genérica,
 * um id malformado escapava do ValidationPipe e virava QueryFailedError no
 * banco. Nas rotas `multipart/form-data` o DTO é a única barreira: o
 * `SurgeryRequestOwnerGuard` roda antes do `FileInterceptor` e não enxerga o
 * corpo.
 */
const UUID_VALIDO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ID_MALFORMADO = 'nao-e-uuid';

const erroDe = async (dto: object, campo: string) => {
  const erros = await validate(dto);
  return erros.find((e) => e.property === campo);
};

describe('DTOs de solicitação cirúrgica — ids uuid', () => {
  describe('CreateDocumentDto', () => {
    const base = {
      key: 'documents/arquivo.pdf',
      name: 'Arquivo',
      folder: STORAGE_FOLDERS.DOCUMENTS,
    };

    it('aceita surgeryRequestId em formato uuid', async () => {
      const dto = plainToInstance(CreateDocumentDto, {
        ...base,
        surgeryRequestId: UUID_VALIDO,
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejeita surgeryRequestId malformado', async () => {
      const dto = plainToInstance(CreateDocumentDto, {
        ...base,
        surgeryRequestId: ID_MALFORMADO,
      });
      expect(await erroDe(dto, 'surgeryRequestId')).toBeDefined();
    });
  });

  describe('DeleteDocumentDto', () => {
    const base = { key: 'documents/arquivo.pdf' };

    it('aceita id e surgeryRequestId em formato uuid', async () => {
      const dto = plainToInstance(DeleteDocumentDto, {
        ...base,
        id: UUID_VALIDO,
        surgeryRequestId: UUID_VALIDO,
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejeita id malformado', async () => {
      const dto = plainToInstance(DeleteDocumentDto, {
        ...base,
        id: ID_MALFORMADO,
        surgeryRequestId: UUID_VALIDO,
      });
      expect(await erroDe(dto, 'id')).toBeDefined();
    });

    it('rejeita surgeryRequestId malformado', async () => {
      const dto = plainToInstance(DeleteDocumentDto, {
        ...base,
        id: UUID_VALIDO,
        surgeryRequestId: ID_MALFORMADO,
      });
      expect(await erroDe(dto, 'surgeryRequestId')).toBeDefined();
    });
  });

  describe('CreateSurgeryRequestProcedureDto', () => {
    const item = { tussCode: '30101018', name: 'Procedimento', quantity: 1 };

    it('aceita surgeryRequestId em formato uuid', async () => {
      const dto = plainToInstance(CreateSurgeryRequestProcedureDto, {
        surgeryRequestId: UUID_VALIDO,
        procedures: [item],
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejeita surgeryRequestId malformado', async () => {
      const dto = plainToInstance(CreateSurgeryRequestProcedureDto, {
        surgeryRequestId: ID_MALFORMADO,
        procedures: [item],
      });
      expect(await erroDe(dto, 'surgeryRequestId')).toBeDefined();
    });

    it('rejeita id de item malformado (quando enviado)', async () => {
      const dto = plainToInstance(ProcedureItemDto, {
        ...item,
        id: ID_MALFORMADO,
      });
      expect(await erroDe(dto, 'id')).toBeDefined();
    });

    it('mantém o id de item opcional', async () => {
      const dto = plainToInstance(ProcedureItemDto, item);
      expect(await validate(dto)).toHaveLength(0);
    });

    /**
     * `procedureId` é campo morto — `ProceduresService.create` nunca o lê. Ele
     * era validado como uuid, mas o catálogo TUSS vem de `tuss.json` e não tem
     * uuid nenhum: o frontend mandava o próprio código no campo e o payload
     * inteiro voltava 400, deixando a SC criada por modelo sem TUSS.
     * Tolerado como string livre para não quebrar cliente com bundle antigo.
     */
    it('tolera procedureId com o código TUSS, que não é uuid', async () => {
      const dto = plainToInstance(ProcedureItemDto, {
        ...item,
        procedureId: '3.07.15.09-1',
      });
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  describe('AuthorizeProceduresDto', () => {
    it('aceita surgeryRequestId em formato uuid', async () => {
      const dto = plainToInstance(AuthorizeProceduresDto, {
        surgeryRequestId: UUID_VALIDO,
        surgeryRequestProcedures: [],
        opmeItems: [],
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejeita surgeryRequestId malformado', async () => {
      const dto = plainToInstance(AuthorizeProceduresDto, {
        surgeryRequestId: ID_MALFORMADO,
        surgeryRequestProcedures: [],
        opmeItems: [],
      });
      expect(await erroDe(dto, 'surgeryRequestId')).toBeDefined();
    });

    it('rejeita id de item malformado', async () => {
      const dto = plainToInstance(AuthorizeProcedureDto, {
        id: ID_MALFORMADO,
        authorizedQuantity: 1,
      });
      expect(await erroDe(dto, 'id')).toBeDefined();
    });
  });

  describe('CreateOpmeDto', () => {
    const base = { name: 'Placa', quantity: 1 };

    it('aceita surgeryRequestId em formato uuid', async () => {
      const dto = plainToInstance(CreateOpmeDto, {
        ...base,
        surgeryRequestId: UUID_VALIDO,
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejeita surgeryRequestId malformado', async () => {
      const dto = plainToInstance(CreateOpmeDto, {
        ...base,
        surgeryRequestId: ID_MALFORMADO,
      });
      expect(await erroDe(dto, 'surgeryRequestId')).toBeDefined();
    });
  });
});
