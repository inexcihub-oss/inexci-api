import { Injectable, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { supabase, SUPABASE_BUCKET } from '../../config/supabase.config';

@Injectable()
export class StorageService {
  /**
   * Faz upload de um arquivo para o Supabase Storage
   * @param file - Arquivo do multer
   * @param folder - Pasta dentro do bucket
   * @returns Caminho do arquivo no bucket
   */
  async create(file: any, folder: string): Promise<string> {
    const filename = `${uuid()}-${file.originalname}`.trim();
    const filePath = `${folder}/${filename}`;

    console.log('=== STORAGE SERVICE - CREATE ===');
    console.log('SUPABASE_BUCKET:', SUPABASE_BUCKET);
    console.log('File path:', filePath);
    console.log('File mimetype:', file.mimetype);
    console.log('File size:', file.buffer?.length || 0);

    try {
      const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      console.log('Supabase response - data:', data);
      console.log('Supabase response - error:', error);

      if (error) {
        console.error('Supabase upload error:', JSON.stringify(error, null, 2));
        throw new BadRequestException(
          `Erro ao fazer upload: ${error.message}`,
        );
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
   * Obtém URL pública do arquivo
   * @param filePath - Caminho do arquivo no bucket
   * @returns URL pública do arquivo
   */
  async getSignedUrl(filePath: string): Promise<string> {
    try {
      const {
        data: { publicUrl },
      } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);

      return publicUrl;
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
        .from(SUPABASE_BUCKET)
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
