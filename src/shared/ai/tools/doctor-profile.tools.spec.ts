import { buildDoctorProfileTools } from './doctor-profile.tools';
import { ToolContext } from './tool.interface';
import { parseToolResult } from './tool-result';

const mockUserRepo = { findOne: jest.fn() };
const mockDoctorProfileRepo = {
  update: jest.fn(),
  findByUserId: jest.fn(),
};
const mockStorageService = {
  create: jest.fn(),
  delete: jest.fn(),
  move: jest.fn(),
};
const mockConfigService = { get: jest.fn().mockReturnValue('') };
const mockDocumentDispatcher = {
  getPending: jest.fn(),
  clearPending: jest.fn(),
};

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
    undefined,
    mockDocumentDispatcher as any,
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
    mockDoctorProfileRepo.findByUserId.mockResolvedValue(null);
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

  // Regressão 2026-05-14: a tool decidia "é colaborador?" lendo
  // `(user as any).doctorProfile` retornado por `userRepo.findOne`. Mas o
  // repo usa `select` (whitelist) sem `doctorProfile: true`, então no
  // TypeORM 0.3 a relação volta `null` mesmo para médicos. Resultado:
  // o Dr. Carlos Mendonça (médico) ouvia "Como você é colaborador,
  // peça ao médico…". Fix: consultar `doctorProfileRepo.findByUserId`
  // direto. Este teste garante que o fix resiste a `userRepo.findOne`
  // devolver `doctorProfile: null` enquanto o profile existe no banco.
  it('médico ainda é detectado quando userRepo.findOne devolve doctorProfile null (bug do select whitelist)', async () => {
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
    });
    mockUserRepo.findOne.mockResolvedValue({
      id: 'user-1',
      doctorProfile: null,
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
    expect(parsed!.status).toBe('pending_confirmation');
    expect(parsed!.display_text).toMatch(/Confirme com "sim"/i);
  });

  // Cenário Gap 1: COLABORADOR (sem doctor_profile) tenta subir assinatura.
  // Não pode tentar upload — devolve envelope blocked com orientação.
  it('colaborador (sem doctor_profile) NÃO sobe assinatura — envelope blocked com orientação', async () => {
    mockDoctorProfileRepo.findByUserId.mockResolvedValue(null);
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
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
    });
    mockDocumentDispatcher.getPending.mockResolvedValue(null);

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute({ confirm: true }, baseContext);

    const parsed = parseToolResult(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('needs_input');
    expect(parsed!.next_required_fields).toEqual(['signature_image']);
    expect(parsed!.display_text).toMatch(/envie a foto da sua assinatura/i);
    expect(mockStorageService.create).not.toHaveBeenCalled();
  });

  it('médico com arquivo NÃO-imagem devolve envelope blocked', async () => {
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
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
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
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
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
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
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: 'signatures/old.png',
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
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: 'https://cdn.exemplo/foo.png',
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

  // Regressão 2026-05-14: usuário envia a foto da assinatura, sistema
  // armazena no staging via DocumentDispatcher. No turno seguinte, o
  // usuário diz "configurar minha assinatura" — `context.inboundMedia`
  // está vazio (a foto foi numa msg anterior), mas o staging tem ela.
  // A tool agora deve usar o staging em vez de pedir a foto novamente.
  it('usa imagem do staging quando inboundMedia está vazio (preview)', async () => {
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
    });
    mockDocumentDispatcher.getPending.mockResolvedValue({
      storagePath: 'whatsapp-tmp/abc-signature.png',
      contentType: 'image/png',
      kind: 'image',
      sizeBytes: 12345,
      fileName: 'signature.png',
      messageSid: 'SM-1',
      receivedAt: Date.now() - 60_000,
      expiresAt: Date.now() + 9 * 60_000,
    });

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute({}, baseContext);

    const parsed = parseToolResult(raw);
    expect(parsed!.status).toBe('pending_confirmation');
    expect(parsed!.display_text).toMatch(/que você acabou de enviar/i);
    expect(parsed!.display_text).toMatch(/Confirme com "sim"/i);
    expect(parsed!.pending_confirmation?.tool).toBe('upload_doctor_signature');
    // mediaIndex NÃO deve ir nos args do pending quando vier do staging
    expect(parsed!.pending_confirmation?.args).not.toHaveProperty('mediaIndex');
  });

  it('com confirm=true e mídia do staging, MOVE arquivo, atualiza profile e limpa staging', async () => {
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
    });
    mockDocumentDispatcher.getPending.mockResolvedValue({
      storagePath: 'whatsapp-tmp/abc-signature.png',
      contentType: 'image/png',
      kind: 'image',
      sizeBytes: 12345,
      fileName: 'signature.png',
      messageSid: 'SM-1',
      receivedAt: Date.now() - 60_000,
      expiresAt: Date.now() + 9 * 60_000,
    });
    mockStorageService.move.mockResolvedValue('signatures/abc-signature.png');
    mockDocumentDispatcher.clearPending.mockResolvedValue(undefined);

    const tool = getTool('upload_doctor_signature');
    const raw = await tool.execute({ confirm: true }, baseContext);

    expect(mockStorageService.move).toHaveBeenCalledWith(
      'whatsapp-tmp/abc-signature.png',
      expect.stringContaining('signatures'),
    );
    expect(mockDoctorProfileRepo.update).toHaveBeenCalledWith('dp-1', {
      signatureUrl: 'signatures/abc-signature.png',
    });
    expect(mockDocumentDispatcher.clearPending).toHaveBeenCalledWith(
      baseContext.phone,
    );
    // O fluxo de staging NÃO deve baixar do Twilio (sem fetch)
    expect(mockStorageService.create).not.toHaveBeenCalled();

    const parsed = parseToolResult(raw);
    expect(parsed!.status).toBe('ok');
    expect(parsed!.display_text).toMatch(/atualizada com sucesso/i);
  });

  it('falha de download do Twilio devolve envelope error', async () => {
    mockDoctorProfileRepo.findByUserId.mockResolvedValue({
      id: 'dp-1',
      signatureUrl: null,
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
