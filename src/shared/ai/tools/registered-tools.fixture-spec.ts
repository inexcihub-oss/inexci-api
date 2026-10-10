import { AiTool } from './tool.interface';
import { AllToolsDeps, buildAllAiTools } from './ai-tools.module';

function deepStub(): unknown {
  const target = function () {};
  return new Proxy(target, {
    get: (_t, prop) => (prop === 'then' ? undefined : deepStub()),
    apply: () => deepStub(),
  });
}

export function buildRegisteredTools(): AiTool[] {
  return buildAllAiTools(deepStub() as AllToolsDeps);
}

export function registeredToolNames(): Set<string> {
  return new Set(buildRegisteredTools().map((t) => t.name));
}
