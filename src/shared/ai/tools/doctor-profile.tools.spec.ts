import { buildDoctorProfileTools } from './doctor-profile.tools';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

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

  it('rejeita quando contexto não tem userId — envelope blocked', async () => {
    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute(
      {},
      { ...baseContext, userId: undefined as any },
    );
    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('blocked');
    expect(parsed!.display_text).toContain('Acesso negado');
  });

  it('usuário inexistente devolve envelope error', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
      },
    );

    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('error');
    expect(parsed!.errors?.[0]?.code).toBe('USER_NOT_FOUND');
  });

  // Cenário Gap 1: COLABORADOR (sem doctor_profile) tenta subir assinatura.
  // Não pode tentar upload — devolve envelope blocked com orientação.
  it('colaborador (sem doctor_profile) NÃO sobe assinatura — envelope blocked com orientação', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: null,
    });

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
      },
    );

    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('blocked');
    expect(parsed!.display_text).toMatch(
      /S[ÓO] pode ser cadastrada por ele mesmo/i,
    );
    expect(parsed!.display_text).toMatch(/pe[çc]a ao m[ée]dico/i);
    expect(mockStorageService.create).not.toHaveBeenCalled();
    expect(mockDoctorProfileRepo.update).not.toHaveBeenCalled();
  });

  it('médico sem mídia anexada devolve envelope needs_input', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute({ confirm: true }, baseContext);

    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('needs_input');
    expect(parsed!.next_required_fields).toEqual(['signature_image']);
    expect(parsed!.display_text).toMatch(/nenhuma imagem/i);
    expect(mockStorageService.create).not.toHaveBeenCalled();
  });

  it('médico com arquivo NÃO-imagem devolve envelope blocked', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [
          { url: 'https://x', contentType: 'application/pdf' },
        ] as any,
      },
    );

    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('blocked');
    expect(parsed!.display_text).toMatch(/não é uma imagem/i);
    expect(parsed!.errors?.[0]?.code).toBe('INVALID_MEDIA_TYPE');
    expect(mockStorageService.create).not.toHaveBeenCalled();
  });

  it('médico sem confirm devolve envelope pending_confirmation com pendingConfirmation', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute(
      {},
      {
        ...baseContext,
        inboundMedia: [{ url: 'https://x', contentType: 'image/png' }] as any,
      },
    );

    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('pending_confirmation');
    expect(parsed!.display_text).toMatch(/Confirme com "sim"/i);
    expect(parsed!.pending_confirmation).toEqual({
      tool: 'upload_doctor_signature',
      args: { confirm: true },
      description: 'atualizar sua assinatura digital',
    });
    expect(mockStorageService.create).not.toHaveBeenCalled();
    expect(mockDoctorProfileRepo.update).not.toHaveBeenCalled();
  });

  it('preview com mediaIndex explícito propaga o índice no pendingConfirmation', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute(
      { mediaIndex: 1 },
      {
        ...baseContext,
        inboundMedia: [
          { url: 'https://a', contentType: 'image/png' },
          { url: 'https://b', contentType: 'image/png' },
        ] as any,
      },
    );

    const parsed = parseToolResult(raw);
    expect(parsed!.status).toBe('pending_confirmation');
    expect(parsed!.pending_confirmation?.args).toEqual({
      mediaIndex: 1,
      confirm: true,
    });
  });

  it('médico com confirm=true sobe assinatura, atualiza doctorProfile, remove a antiga e devolve envelope ok', async () => {
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
    const raw = await tool.execute(
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

    const parsed = parseToolResult<{ signatureUrl: string }>(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('ok');
    expect(parsed!.display_text).toMatch(/atualizada com sucesso/i);
    expect(parsed!.display_text).toMatch(/pr[óo]ximos laudos/i);
    expect(parsed!.data?.signatureUrl).toBe('signatures/new.png');

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

  it('falha de download do Twilio devolve envelope error', async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: { id: 'dp-1', signatureUrl: null },
    });

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 502,
    } as any);

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute(
      { confirm: true },
      {
        ...baseContext,
        inboundMedia: [
          { url: 'https://api.twilio.com/m/1', contentType: 'image/png' },
        ] as any,
      },
    );

    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('error');
    expect(parsed!.errors?.[0]?.code).toBe('SIGNATURE_UPLOAD_FAILED');

    fetchMock.mockRestore();
  });
});
