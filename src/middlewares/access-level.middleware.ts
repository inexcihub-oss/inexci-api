import {
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { AccessLevels, HttpMessages } from 'src/common';
import { UserRole } from 'src/database/entities/user.entity';
import { NextFunction, Request, Response } from 'express';
import { UserRepository } from 'src/database/repositories/user.repository';

@Injectable()
export class AccessLevel implements NestMiddleware {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const bearerHeader = req.headers.authorization;
    const accessToken = bearerHeader && bearerHeader.split(' ')[1];

    if (accessToken) {
      // Tentar encontrar o access level exato primeiro
      let accessLevel = AccessLevels[req.baseUrl]?.[req.method];

      // Se não encontrar, tentar com pattern matching para rotas dinâmicas
      if (!accessLevel) {
        // Substituir tanto UUIDs quanto IDs numéricos por :id (ordem importa!)
        let routePattern = req.baseUrl
          .replace(
            /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            '/:id',
          )
          .replace(/\/\d+/g, '/:id');
        accessLevel = AccessLevels[routePattern]?.[req.method];

        // Se ainda não encontrou, tentar com outros nomes de parâmetros comuns
        if (!accessLevel) {
          // Tentar variações comuns de nomes de parâmetros
          const paramVariations = [
            ':surgeryRequestId',
            ':requestId',
            ':patientId',
            ':hospitalId',
            ':userId',
          ];

          for (const paramName of paramVariations) {
            const variantPattern = routePattern.replace(/:id/g, paramName);
            accessLevel = AccessLevels[variantPattern]?.[req.method];
            if (accessLevel) break;
          }
        }
      }

      if (!accessLevel) {
        throw new HttpException(
          HttpMessages.permissionDenied,
          HttpStatus.UNAUTHORIZED,
        );
      }

      try {
        const jwtSecret =
          this.configService.get<string>('JWT_SECRET') ||
          'fallback-secret-for-development';
        const { userId } = verify(accessToken, jwtSecret) as any;

        const user = await this.userRepository.findOne({ id: userId });

        if (!user) {
          throw new HttpException(
            HttpMessages.permissionDenied,
            HttpStatus.UNAUTHORIZED,
          );
        }

        // Verifica se o role do usuário está na lista de roles permitidos
        const hasPermission = accessLevel.includes(user.role as UserRole);

        if (!hasPermission)
          throw new HttpException(
            HttpMessages.permissionDenied,
            HttpStatus.UNAUTHORIZED,
          );
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        throw new HttpException(
          HttpMessages.permissionDenied,
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    next();
  }
}
