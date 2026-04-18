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
    BullModule.registerQueue({
      name: 'ai-messages',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
