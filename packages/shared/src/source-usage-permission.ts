import { z } from "zod";

const permissionStatusSchema = z.enum(["allowed", "denied", "unknown"]);

// WHY：来源读取、证据保存和派生知识发布是三个独立权利，必须沿生产链显式传递，
// 不能根据“页面可访问”或证据隐私等级反推出发布许可。
export const sourceUsagePermissionSchema = z.object({
  localRead: permissionStatusSchema,
  modelInput: permissionStatusSchema,
  evidenceStorage: permissionStatusSchema,
  derivedKnowledgePublication: permissionStatusSchema,
  sourceRedistribution: permissionStatusSchema,
  basis: z.string().min(1).max(2000),
  basisUrl: z.string().url().optional(),
}).strict();

export type SourceUsagePermission = z.infer<typeof sourceUsagePermissionSchema>;
