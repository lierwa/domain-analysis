import {
  confirmedProjectSnapshotSchema,
  type FrozenPipelineInput,
  type PipelineModule,
  type PipelineRunView,
} from "@domain-analysis/shared";

import { ProductProjectError, type ProductProjectModule } from "./productProjectModule";

export interface ProductPipelineModule {
  start(projectId: string, requestedBy: string): Promise<PipelineRunView>;
}

export function createProductPipelineModule(
  productProjects: ProductProjectModule,
  pipeline: PipelineModule,
): ProductPipelineModule {
  return {
    start: async (projectId, requestedBy) => {
      const project = await productProjects.get(projectId);
      if (!project) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
      const confirmed = confirmedProjectSnapshotSchema.safeParse(project);
      if (!confirmed.success) {
        throw new ProductProjectError("incomplete", "项目输入尚未确认，不能启动搜集流水线");
      }

      // WHY：只把冻结版本身份交给 Pipeline，后续编辑不会悄悄改变已启动运行的输入。
      return pipeline.start({ requestedBy, input: toFrozenPipelineInput(confirmed.data) });
    },
  };
}

export function toFrozenPipelineInput(
  project: ReturnType<typeof confirmedProjectSnapshotSchema.parse>,
): FrozenPipelineInput {
  return {
    projectId: project.project.id,
    projectRevision: project.project.revision,
    categoryDefinitionVersionId: project.categoryDefinition.id,
    categoryDefinitionHash: project.categoryDefinition.contentHash,
    confirmedScopeVersionId: project.confirmedScope.id,
    confirmedScopeHash: project.confirmedScope.contentHash,
    collectionBoardVersionId: project.collectionBoard.id,
    collectionBoardHash: project.collectionBoard.contentHash,
  };
}
