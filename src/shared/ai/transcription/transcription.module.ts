import { Module } from '@nestjs/common';
import { TranscriptionService } from './transcription.service';
import { FasterWhisperProvider } from './providers/faster-whisper.provider';
import { OpenaiWhisperProvider } from './providers/openai-whisper.provider';

@Module({
  providers: [
    TranscriptionService,
    FasterWhisperProvider,
    OpenaiWhisperProvider,
  ],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}
