import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'mail',
    }),
    BullModule.registerQueue({
      name: 'whatsapp-messages',
    }),
    BullModule.registerQueue({
      name: 'pdf-generation',
    }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
