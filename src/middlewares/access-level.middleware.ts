import {
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { AccessLevels, HttpMessages } from 'src/common';
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
        const routePattern = req.baseUrl.replace(/\/\d+/g, '/:id');
        accessLevel = AccessLevels[routePattern]?.[req.method];
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

        const hasPermission = accessLevel.findIndex(
          (profile: number) => profile === user.profile,
        );

        if (hasPermission === -1)
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
