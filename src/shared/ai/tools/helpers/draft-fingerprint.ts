import { ToolContext } from '../tool.interface';
import { OperationDraftService } from '../../services/operation-draft.service';

export function draftConfirmationFingerprint(
  draftService: Pick<OperationDraftService, 'getCurrent'>,
): (context: ToolContext) => Promise<unknown> {
  return async (context) => {
    const draft = await draftService.getCurrent(context.conversationId);
    if (!draft) return null;
    return { type: draft.type, fields: draft.fields };
  };
}
