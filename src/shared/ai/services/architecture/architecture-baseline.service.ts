import { Inject, Injectable, Optional } from '@nestjs/common';
import { AI_TOOL } from '../../tools/tool.interface';
import { SYSTEM_PROMPT } from '../../prompts/system-prompt';

export interface AiArchitectureBaseline {
  legacySystemPromptChars: number;
  legacySystemPromptEstimatedTokens: number;
  coreSystemPromptChars: number;
  coreSystemPromptEstimatedTokens: number;
  registeredTools: number;
}

@Injectable()
export class ArchitectureBaselineService {
  constructor(@Optional() @Inject(AI_TOOL) private readonly allTools: unknown[] = []) {}

  snapshot(corePrompt: string): AiArchitectureBaseline {
    return {
      legacySystemPromptChars: SYSTEM_PROMPT.length,
      legacySystemPromptEstimatedTokens: Math.ceil(SYSTEM_PROMPT.length / 4),
      coreSystemPromptChars: corePrompt.length,
      coreSystemPromptEstimatedTokens: Math.ceil(corePrompt.length / 4),
      registeredTools: this.allTools.length,
    };
  }
}
