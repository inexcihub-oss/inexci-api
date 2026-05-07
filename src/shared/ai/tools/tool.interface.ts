import OpenAI from 'openai';

export interface ToolContext {
  userId: string | null;
  phone: string;
  accessibleDoctorIds: string[];
  conversationId: string;
  inboundMedia?: Array<{
    url: string;
    contentType?: string | null;
  }>;
}

export interface AiTool {
  name: string;
  definition: OpenAI.ChatCompletionTool;
  execute(args: Record<string, any>, context: ToolContext): Promise<string>;
}
