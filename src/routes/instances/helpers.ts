import { InstanceService } from "../../services/instance.ts";
import { NotFoundError } from "../../middleware/error-handler.ts";
import type { Instance } from "../../types/index.ts";

export function resolveInstance(instanceService: InstanceService, name: string): Instance {
  const instance = instanceService.get(name);
  if (!instance) throw new NotFoundError(`Instance "${name}" not found`);
  return instance;
}
