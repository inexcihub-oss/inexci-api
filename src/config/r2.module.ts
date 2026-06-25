import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { R2_CLIENT, createR2Client } from './r2.config';

@Global()
@Module({
  providers: [
    {
      provide: R2_CLIENT,
      useFactory: (config: ConfigService) => createR2Client(config),
      inject: [ConfigService],
    },
  ],
  exports: [R2_CLIENT],
})
export class R2Module {}
