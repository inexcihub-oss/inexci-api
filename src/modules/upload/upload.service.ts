import { Injectable, BadRequestException } from '@nestjs/common';
import { supabase, SUPABASE_BUCKET } from '../../config/supabase.config';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  /**
   * Faz upload de um arquivo para o Supabase Storage
   * @param file - Arquivo do multer
   * @param folder - Pasta dentro do bucket (ex: 'documents', 'avatars')
   * @returns URL pública do arquivo
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'documents',
  ): Promise<{ url: string; path: string }> {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    // Gerar nome único para o arquivo
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${uuidv4()}.${fileExtension}`;
    const filePath = `${folder}/${fileName}`;

    try {
      // Upload para o Supabase Storage
      const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        throw new BadRequestException(
          `Erro ao fazer upload: ${error.message}`,
        );
      }

      // Obter URL pública do arquivo
      const {
        data: { publicUrl },
      } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(data.path);

      return {
        url: publicUrl,
        path: data.path,
      };
    } catch (error) {
      throw new BadRequestException(
        `Erro ao fazer upload do arquivo: ${error.message}`,
      );
    }
  }

  /**
   * Deleta um arquivo do Supabase Storage
   * @param filePath - Caminho do arquivo no bucket
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      const { error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .remove([filePath]);

      if (error) {
        throw new BadRequestException(
          `Erro ao deletar arquivo: ${error.message}`,
        );
      }
    } catch (error) {
      throw new BadRequestException(
        `Erro ao deletar arquivo: ${error.message}`,
      );
    }
  }

  /**
   * Faz upload de múltiplos arquivos
   * @param files - Array de arquivos do multer
   * @param folder - Pasta dentro do bucket
   * @returns Array de URLs públicas
   */
  async uploadMultipleFiles(
    files: Express.Multer.File[],
    folder: string = 'documents',
  ): Promise<Array<{ url: string; path: string; originalName: string }>> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const uploadPromises = files.map(async (file) => {
      const result = await this.uploadFile(file, folder);
      return {
        ...result,
        originalName: file.originalname,
      };
    });

    return Promise.all(uploadPromises);
  }
}
