import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tools/tool.interface';
import { buildSurgeryRequestTools } from '../tools/surgery-request.tools';
import { buildPendencyTools } from '../tools/pendency.tools';
import { buildGeneralTools } from '../tools/general.tools';
import { buildActionTools } from '../tools/action.tools';
import { buildNotificationTools } from '../tools/notification.tools';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestMutationService } from '../../../modules/surgery-requests/services/surgery-request-mutation.service';
import { SurgeryRequestNotificationService } from '../../../modules/surgery-requests/services/surgery-request-notification.service';

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, AiTool>();

  constructor(
    private readonly surgeryRequestRepo: SurgeryRequestRepository,
    private readonly activityRepo: SurgeryRequestActivityRepository,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly patientRepo: PatientRepository,
    private readonly workflowService: SurgeryRequestWorkflowService,
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly notificationService: SurgeryRequestNotificationService,
  ) {
    this.registerAll();
  }

  private registerAll(): void {
    const allTools: AiTool[] = [
      ...buildSurgeryRequestTools(this.surgeryRequestRepo),
      ...buildPendencyTools(this.pendencyValidator, this.surgeryRequestRepo),
      ...buildGeneralTools(this.patientRepo),
      ...buildActionTools(
        this.surgeryRequestRepo,
        this.workflowService,
        this.mutationService,
        this.pendencyValidator,
        this.activityRepo,
      ),
      ...buildNotificationTools(this.surgeryRequestRepo, this.notificationService, this.activityRepo),
    ];

    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
    }
  }

  getToolDefinitions(): OpenAI.ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getTool(name: string): AiTool | undefined {
    return this.tools.get(name);
  }

  async executeTool(
    name: string,
    args: Record<string, any>,
    context: ToolContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Ferramenta "${name}" não encontrada.`;
    return tool.execute(args, context);
  }
}
