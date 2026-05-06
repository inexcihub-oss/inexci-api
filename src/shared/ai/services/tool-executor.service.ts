import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ToolRegistryService } from './tool-registry.service';
import { ToolContext } from '../tools/tool.interface';

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async executeMany(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[],
    context: ToolContext,
  ): Promise<Array<{ toolCallId: string; output: string }>> {
    const results: Array<{ toolCallId: string; output: string }> = [];

    for (const call of toolCalls) {
      const fn = (call as any).function as { name: string; arguments: string };
      try {
        const args = JSON.parse(fn.arguments);
        this.logger.log(
          `Executando tool: ${fn.name} args=${JSON.stringify(args)}`,
        );
        const output = await this.toolRegistry.executeTool(
          fn.name,
          args,
          context,
        );
        results.push({ toolCallId: call.id, output });
      } catch (error: any) {
        this.logger.error(`Erro na tool ${fn.name}: ${error.message}`);
        results.push({
          toolCallId: call.id,
          output: `Erro ao executar ação: ${error.message}`,
        });
      }
    }

    return results;
  }
}
