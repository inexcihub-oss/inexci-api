import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EntityManager } from 'typeorm';
import { Document } from 'src/database/entities/document.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { ArmazenamentoImportacao } from '../../core/armazenamento';
import { sharp } from 'src/shared/storage/foto-paciente';
import { LEDGER_FICHA } from '../mappers/clinical-record.mapper';
import {
  Disco,
  LEDGER_DOCUMENTO,
  LEDGER_FOTO,
  planejarAnexos,
} from '../mappers/document.mapper';
import { LEDGER_PACIENTE } from '../mappers/patient.mapper';
import { ExportFeegow } from '../export';
import {
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import { planejarCadastro } from './cadastro.phase';
import { enviarAnexos, gravarAnexos, PlanoAnexos } from './anexos.phase';

const ARQUIVOS_NO_DISCO = new Set([
  'Arquivos/laudo.pdf',
  'Arquivos/foto.jfif',
  'Perfil/abc.png',
  'Perfil/def.gif',
  'Perfil/orfa.png',
]);

/** Disco falso: o export sintético mora em `/export`. */
const disco: Disco = {
  existe: (c) => ARQUIVOS_NO_DISCO.has(c.replace(/^\/export\/Client\//, '')),
  listar: (p) =>
    p.endsWith('Perfil')
      ? [...ARQUIVOS_NO_DISCO]
          .filter((a) => a.startsWith('Perfil/'))
          .map((a) => a.slice(7))
      : [],
};

function arquivo(
  id: string,
  paciente: string,
  nome: string,
  extra: object = {},
) {
  return {
    id,
    NomeArquivo: nome,
    Descricao: `Exame ${id}`,
    PacienteID: paciente,
    DataHora: '2026-07-03 08:39:46',
    sysActive: '1',
    AtendimentoID: null,
    ...extra,
  };
}

function planejar(
  tabelas: Record<string, unknown[]>,
  ledgerExtra?: (l: ReturnType<typeof contextoDeTeste>['ledger']) => void,
) {
  const base = exportSintetico(tabelas as never);
  // Mesmas tabelas, mas com pasta (para `arquivo()` montar o caminho).
  const exp = Object.assign(Object.create(ExportFeegow.prototype), base, {
    dir: '/export',
  }) as ExportFeegow;
  const ctx0 = contextoDeTeste({
    usuariosPorEmail: new Map([
      [
        'dono@exemplo.com',
        {
          id: OWNER,
          ownerId: OWNER,
          email: 'dono@exemplo.com',
          temPerfil: true,
        },
      ],
    ]),
  });
  planejarCadastro(exp, ctx0);
  ledgerExtra?.(ctx0.ledger);
  const ctx = contextoDeTeste({ ledger: ctx0.ledger });
  return { ctx, ...planejarAnexos(exp, ctx, disco) };
}

describe('planejarAnexos', () => {
  it('anexo do paciente: tipo, chave, nome, data e ficha do atendimento', () => {
    const { ctx, documentos } = planejar(
      { arquivos: [arquivo('5', '10', 'laudo.pdf', { AtendimentoID: 'a1' })] },
      (l) => l.registrar(LEDGER_FICHA, 'atd:a1', 'ficha-1'),
    );
    expect(documentos).toHaveLength(1);
    expect(documentos[0]).toMatchObject({
      patientId: ctx.ledger.resolver(LEDGER_PACIENTE, '10'),
      clinicalRecordId: 'ficha-1',
      createdById: OWNER,
      type: 'additional_document',
      key: 'feegow_5',
      name: 'Exame 5',
      uri: null,
      arquivo: {
        caminhoLocal: '/export/Client/Arquivos/laudo.pdf',
        contentType: 'application/pdf',
      },
    });
    expect(documentos[0].createdAt.toISOString()).toBe(
      '2026-07-03T11:39:46.000Z',
    );
    expect(ctx.ledger.resolver(LEDGER_DOCUMENTO, '5')).toBe(documentos[0].id);
  });

  it('nome acima de 75 caracteres é cortado; sem descrição usa o arquivo', () => {
    const { documentos } = planejar({
      arquivos: [
        arquivo('1', '10', 'laudo.pdf', { Descricao: 'x'.repeat(90) }),
        arquivo('2', '10', 'foto.jfif', { Descricao: null }),
      ],
    });
    expect(documentos[0].name).toHaveLength(75);
    expect(documentos[1]).toMatchObject({
      name: 'foto.jfif',
      arquivo: { contentType: 'image/jpeg' },
    });
  });

  it('arquivo da clínica, inativo ou de paciente não importado fica de fora', () => {
    const { ctx, documentos } = planejar({
      arquivos: [
        arquivo('1', '0', 'laudo.pdf'),
        arquivo('2', '10', 'laudo.pdf', { sysActive: '-1' }),
        arquivo('3', '12', 'laudo.pdf'),
      ],
    });
    expect(documentos).toHaveLength(0);
    expect(ctx.relatorio.rejeicoes.map((r) => r.motivo)).toEqual([
      'paciente não importado',
    ]);
  });

  it('arquivo ausente no export é rejeitado', () => {
    const { ctx } = planejar({ arquivos: [arquivo('1', '10', 'sumiu.pdf')] });
    expect(ctx.relatorio.rejeicoes[0].motivo).toBe(
      'arquivo ausente no export (Arquivos/sumiu.pdf)',
    );
  });

  it('foto referenciada vira photoPath; formato não aceito e órfã ficam de fora', () => {
    const { ctx, fotos } = planejar({
      pacientes: [
        { ...pacienteBase('10'), foto: 'abc.png' },
        { ...pacienteBase('11'), foto: 'def.gif' },
      ],
    });
    expect(fotos).toEqual([
      {
        patientId: ctx.ledger.resolver(LEDGER_PACIENTE, '10'),
        photoPath: null,
        arquivo: {
          caminhoLocal: '/export/Client/Perfil/abc.png',
          nome: 'abc.png',
          contentType: 'image/png',
        },
      },
    ]);
    expect(ctx.ledger.resolver(LEDGER_FOTO, '10')).not.toBeNull();
    expect(ctx.relatorio.rejeicoes[0].motivo).toBe(
      'extensão não aceita (.gif)',
    );
    expect(
      ctx.relatorio.avisos.some((a) =>
        a.aviso.startsWith('1 arquivos em Client/Perfil'),
      ),
    ).toBe(true);
  });
});

function pacienteBase(id: string) {
  return {
    id,
    nome_paciente: `Paciente ${id}`,
    cpf: null,
    celular: '24999991234',
    sexo: '2',
    nascimento: '1990-05-02',
    sys_active: '1',
    sys_date: '2023-01-12 00:00:00',
  };
}

describe('enviarAnexos e gravarAnexos', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'anexos-'));
  writeFileSync(join(pasta, 'a.pdf'), 'pdf');
  beforeAll(async () => {
    writeFileSync(
      join(pasta, 'b.png'),
      await sharp({
        create: { width: 640, height: 480, channels: 3, background: '#808080' },
      })
        .png()
        .toBuffer(),
    );
  });

  const plano = (): PlanoAnexos => ({
    ownerId: OWNER,
    documentos: [
      {
        id: 'doc-1',
        patientId: 'p-1',
        clinicalRecordId: null,
        createdById: OWNER,
        type: 'additional_document',
        key: 'feegow_1',
        name: 'Exame',
        uri: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        arquivo: {
          caminhoLocal: join(pasta, 'a.pdf'),
          nome: 'a.pdf',
          contentType: 'application/pdf',
        },
      },
    ],
    fotos: [
      {
        patientId: 'p-1',
        photoPath: null,
        arquivo: {
          caminhoLocal: join(pasta, 'b.png'),
          nome: 'b.png',
          contentType: 'image/png',
        },
      },
    ],
  });

  it('sobe documentos em documents/ e fotos em patient-photos/ da conta', async () => {
    const armazenamento: ArmazenamentoImportacao = {
      enviar: jest.fn(async (a) => `${a.pasta}/${a.tenantId}/${a.nome}`),
      apagar: jest.fn(),
    };
    const p = plano();

    const enviados = await enviarAnexos(p, armazenamento);

    expect(enviados).toEqual([
      `documents/${OWNER}/a.pdf`,
      `patient-photos/${OWNER}/b.webp`,
    ]);
    expect(p.documentos[0].uri).toBe(`documents/${OWNER}/a.pdf`);
    expect(p.fotos[0].photoPath).toBe(`patient-photos/${OWNER}/b.webp`);
    const foto = (armazenamento.enviar as jest.Mock).mock.calls[1][0];
    expect(foto.contentType).toBe('image/webp');
    expect((await sharp(foto.conteudo).metadata()).format).toBe('webp');
    expect(
      (armazenamento.enviar as jest.Mock).mock.calls[0][0].conteudo.toString(),
    ).toBe('pdf');
  });

  it('falha no meio do envio apaga o que já subiu', async () => {
    const armazenamento: ArmazenamentoImportacao = {
      enviar: jest
        .fn()
        .mockResolvedValueOnce('documents/x/a.pdf')
        .mockRejectedValueOnce(new Error('R2 fora')),
      apagar: jest.fn(),
    };

    await expect(enviarAnexos(plano(), armazenamento)).rejects.toThrow(
      'R2 fora',
    );
    expect(armazenamento.apagar).toHaveBeenCalledWith(['documents/x/a.pdf']);
  });

  it('gravar insere os documentos sem o arquivo local e só põe foto onde não há', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ execute, orIgnore: jest.fn() });
    const into = jest.fn().mockReturnValue({ values });
    const update = jest.fn().mockResolvedValue(undefined);
    const manager = {
      createQueryBuilder: () => ({ insert: () => ({ into }) }),
      update,
    } as unknown as EntityManager;
    const p = plano();
    p.documentos[0].uri = 'documents/x/a.pdf';
    p.fotos[0].photoPath = 'patient-photos/x/b.png';

    await gravarAnexos(p, manager);

    expect(into).toHaveBeenCalledWith(Document);
    expect(values.mock.calls[0][0][0]).not.toHaveProperty('arquivo');
    expect(values.mock.calls[0][0][0].uri).toBe('documents/x/a.pdf');
    expect(update).toHaveBeenCalledWith(
      Patient,
      expect.objectContaining({ id: 'p-1' }),
      { photoPath: 'patient-photos/x/b.png' },
    );
  });

  it('gravar sem upload feito é erro (nunca grava documento sem arquivo)', async () => {
    await expect(gravarAnexos(plano(), {} as EntityManager)).rejects.toThrow(
      'rode enviarAnexos',
    );
  });
});
