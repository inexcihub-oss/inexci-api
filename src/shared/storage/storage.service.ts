import { Injectable, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { supabaseAdmin } from '../../config/supabase.config';
import { STORAGE_BUCKET } from '../../config/storage.config';

// Usa supabaseAdmin (service_role) para todas as operações de storage,
// garantindo que as políticas RLS não bloqueiem o backend.
const supabase = supabaseAdmin;

@Injectable()
export class StorageService {
  /**
   * Sanitiza o nome do arquivo removendo acentos e caracteres inválidos
   * para garantir compatibilidade com as chaves do Supabase Storage.
   */
  private sanitizeFilename(name: string): string {
    return name
      .normalize('NFD') // decompõe caracteres acentuados (ex: "à" → "a" + combining accent)
      .replace(/[\u0300-\u036f]/g, '') // remove marcas diacríticas combinadas
      .replace(/[^a-zA-Z0-9._-]/g, '_') // substitui caracteres inválidos por "_"
      .replace(/_+/g, '_') // colapsa underscores consecutivos
      .replace(/^_|_$/g, ''); // remove underscores no início/fim
  }

  /**
   * Faz upload de um arquivo para o Supabase Storage
   * @param file - Arquivo do multer
   * @param folder - Pasta dentro do bucket
   * @returns Caminho do arquivo no bucket
   */
  async create(file: any, folder: string): Promise<string> {
    const sanitizedName = this.sanitizeFilename(file.originalname);
    const filename = `${uuid()}-${sanitizedName}`;
    const filePath = `${folder}/${filename}`;

    console.log('=== STORAGE SERVICE - CREATE ===');
    console.log('BUCKET:', STORAGE_BUCKET);
    console.log('File path:', filePath);
    console.log('File mimetype:', file.mimetype);
    console.log('File size:', file.buffer?.length || 0);

    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      console.log('Supabase response - data:', data);
      console.log('Supabase response - error:', error);

      if (error) {
        console.error('Supabase upload error:', JSON.stringify(error, null, 2));
        throw new BadRequestException(`Erro ao fazer upload: ${error.message}`);
      }

      return data.path;
    } catch (error: any) {
      console.error('Storage service error:', error);
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${error.message}`,
      );
    }
  }

  /**
   * Gera URL assinada (válida por 1 hora) para acesso a arquivo privado
   * @param filePath - Caminho do arquivo no bucket
   * @returns URL assinada temporária
   */
  async getSignedUrl(filePath: string): Promise<string> {
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(filePath, 3600); // expira em 1 hora

      if (error || !data?.signedUrl) {
        throw new BadRequestException(
          `Erro ao gerar URL assinada: ${error?.message ?? 'URL inválida'}`,
        );
      }

      return data.signedUrl;
    } catch (error: any) {
      throw new BadRequestException(
        `Erro ao obter URL do arquivo: ${error.message}`,
      );
    }
  }

  /**
   * Deleta um arquivo do Supabase Storage
   * @param filePath - Caminho do arquivo no bucket
   */
  async delete(filePath: string): Promise<void> {
    try {
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([filePath]);

      if (error) {
        throw new BadRequestException(
          `Erro ao deletar arquivo: ${error.message}`,
        );
      }
    } catch (error: any) {
      throw new BadRequestException(
        `Erro ao deletar arquivo: ${error.message}`,
      );
    }
  }
}
