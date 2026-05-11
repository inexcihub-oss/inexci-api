import { buildDoctorProfileTools } from './doctor-profile.tools';
import { ToolContext } from './tool.interface';

const mockUserRepo = { findOne: jest.fn() };
const mockDoctorProfileRepo = { update: jest.fn() };
const mockStorageService = {
  create: jest.fn(),
  delete: jest.fn(),
};
const mockConfigService = { get: jest.fn().mockReturnValue('') };

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['user-1'],
  conversationId: 'conv-1',
};

describe('DoctorProfileTools — upload_doctor_signature', () => {
  const tools = buildDoctorProfileTools(
    mockUserRepo as any,
    mockDoctorProfileRepo as any,
    mockStorageService as any,
    mockConfigService as any,
  );
  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => jest.clearAllMocks());

  it('rejeita quando contexto não tem userId', async () => {
    const tool = getTool('upload_doctor_signature');
    const result = await tool.execute(
      {},
      { ...baseContext, userId: undefined as any },
    );
    expect(result).toContain('Acesso negado');
  });

  // Cenário Gap 1: COLABORADOR (sem doctor_profile) tenta subir assinatura.
  // Não pode tentar upload — devolve mensagem orientando a falar com o médico.
  it('colaborador (sem doctor_profile) NÃO sobe assinatura — recebe orientação', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: null,
    });

    const tool = getTool('upload_doctor_signature');
    const result = await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
      },
    );

    expect(result).toMatch(/S[ÓO] pode ser cadastrada por ele mesmo/i);
    expect(result).toMatch(/pe[çc]a ao m[ée]dico/i);
    expect(mockStorageService.create).not.toHaveBeenCalled();
    expect(mockDoctorProfileRepo.update).not.toHaveBeenCalled();
  });

  it('médico sem mídia anexada recebe instrução para enviar a imagem', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const tool = getTool('upload_doctor_signature');
    const result = await tool.execute({ confirm: true }, baseContext);

    expect(result).toMatch(/nenhuma imagem/i);
    expect(mockStorageService.create).not.toHaveBeenCalled();
  });

  it('médico com arquivo NÃO-imagem recebe erro de validação', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const tool = getTool('upload_doctor_signature');
    const result = await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [
          { url: 'https://x', contentType: 'application/pdf' },
        ] as any,
      },
    );

    expect(result).toMatch(/não é uma imagem/i);
    expect(mockStorageService.create).not.toHaveBeenCalled();
  });

  it('médico sem confirm recebe preview (sem persistência)', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const tool = getTool('upload_doctor_signature');
    const result = await tool.execute(
      {},
      {
        ...baseContext,
        inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
      },
    );

    expect(result).toMatch(/Confirme com "sim"/i);
    expect(mockStorageService.create).not.toHaveBeenCalled();
    expect(mockDoctorProfileRepo.update).not.toHaveBeenCalled();
  });

  it('médico com confirm=true sobe a assinatura, atualiza doctorProfile e remove a antiga', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: 'signatures/old.png' },
    });
    mockStorageService.create.mockResolvedValue('signatures/new.png');
    mockStorageService.delete.mockResolvedValue(undefined);

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as any);

    const tool = getTool('upload_doctor_signature');
    const result = await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [
          { url: 'https://api.twilio.com/m/1', contentType: 'image/png' },
        ] as any,
      },
    );

    expect(mockStorageService.create).toHaveBeenCalled();
    expect(mockStorageService.delete).toHaveBeenCalledWith(
      'signatures/old.png',
    );
    expect(mockDoctorProfileRepo.update).toHaveBeenCalledWith('dp-1', {
      signatureUrl: 'signatures/new.png',
    });
    expect(result).toMatch(/atualizada com sucesso/i);
    expect(result).toMatch(/pr[óo]ximos laudos/i);

    fetchMock.mockRestore();
  });

  // Garante que se a assinatura anterior for uma URL externa (http), a tool
  // NÃO tenta deletar do storage interno.
  it('não tenta deletar a assinatura antiga quando ela é uma URL externa', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: {
        id: 'dp-1',
        signatureUrl: 'https://cdn.exemplo/foo.png',
      },
    });
    mockStorageService.create.mockResolvedValue('signatures/new.png');

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    } as any);

    const tool = getTool('upload_doctor_signature');
    await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [
          { url: 'https://api.twilio.com/m/1', contentType: 'image/png' },
        ] as any,
      },
    );

    expect(mockStorageService.delete).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
