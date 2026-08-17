import { z } from "zod";

import {
  documentExcerptEvidenceLocatorSchema,
  knowledgeNeedReferenceSchema,
  tableRegionEvidenceLocatorSchema,
  webTextEvidenceLocatorSchema,
} from "./evidence";
import { knowledgeLayers } from "./product-knowledge";

const idSchema = z.string().min(1).max(240);
const httpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", {
  message: "公开网页采集只接受 HTTPS URL",
});

const collectionInputShape = {
  collectionLaneId: idSchema,
  targetKey: idSchema,
  knowledgeNeed: knowledgeNeedReferenceSchema,
  question: z.string().min(1).max(1000),
  knowledgeLayer: z.enum(knowledgeLayers),
  sourceIdentity: idSchema,
};

// WHY：CSS selector 只是本次访问线索，不能携带品类字段映射或成为永久事实源。
export const publicWebTextCollectionInputSchema = z.object({
  ...collectionInputShape,
  requestedUrl: httpsUrlSchema,
  selector: z.string().min(1).max(500),
  requiredText: z.string().min(1).max(1000),
}).strict();

export const energyLabelRecordCollectionInputSchema = z.object({
  ...collectionInputShape,
  productModel: z.string().trim().min(1).max(240),
}).strict();

export const documentExcerptCollectionInputSchema = z.object({
  ...collectionInputShape,
  requestedUrl: httpsUrlSchema,
  requiredText: z.string().min(1).max(1000),
  requiredSectionTerms: z.array(z.string().min(1).max(240)).min(1).max(10),
  section: z.string().min(1).max(500),
}).strict().superRefine((input, context) => {
  if (new Set(input.requiredSectionTerms).size !== input.requiredSectionTerms.length) {
    context.addIssue({ code: "custom", path: ["requiredSectionTerms"], message: "章节定位词不得重复" });
  }
});

export const cnisRegistryRowCollectionInputSchema = z.object({
  ...collectionInputShape,
  productModel: z.string().trim().min(1).max(240),
  year: z.number().int().min(2016).max(2024),
}).strict();

export const energyLabelRecordCaptureInputSchema = z.object({
  productModel: z.string().trim().min(1).max(240),
  maximumBytes: z.number().int().positive().max(64 * 1024),
}).strict();

export const publicWebTextCaptureInputSchema = z.object({
  requestedUrl: httpsUrlSchema,
  selector: z.string().min(1).max(500),
  requiredText: z.string().min(1).max(1000),
  maximumBytes: z.number().int().positive().max(64 * 1024),
}).strict();

export const documentExcerptCaptureInputSchema = z.object({
  requestedUrl: httpsUrlSchema,
  requiredText: z.string().min(1).max(1000),
  requiredSectionTerms: z.array(z.string().min(1).max(240)).min(1).max(10),
  section: z.string().min(1).max(500),
  maximumSourceBytes: z.number().int().positive().max(20 * 1024 * 1024),
  maximumExcerptBytes: z.number().int().positive().max(256 * 1024),
}).strict();

export const cnisRegistryRowCaptureInputSchema = z.object({
  productModel: z.string().trim().min(1).max(240),
  year: z.number().int().min(2016).max(2024),
  maximumArchiveBytes: z.number().int().positive().max(100 * 1024 * 1024),
  maximumEvidenceBytes: z.number().int().positive().max(1024 * 1024),
}).strict();

export const publicWebTextCaptureSchema = z.object({
  requestedUrl: httpsUrlSchema,
  finalUrl: httpsUrlSchema,
  observedAt: z.string().datetime({ offset: true }),
  httpValidation: z.object({
    status: z.number().int().min(100).max(599),
    etag: z.string().min(1).max(1000).optional(),
    lastModified: z.string().min(1).max(1000).optional(),
  }).strict(),
  content: z.string().min(2),
  locator: webTextEvidenceLocatorSchema,
}).strict();

export const documentExcerptCaptureSchema = z.object({
  requestedUrl: httpsUrlSchema,
  finalUrl: httpsUrlSchema,
  observedAt: z.string().datetime({ offset: true }),
  httpValidation: z.object({
    status: z.number().int().min(100).max(599),
    etag: z.string().min(1).max(1000).optional(),
    lastModified: z.string().min(1).max(1000).optional(),
  }).strict(),
  content: z.string().min(2),
  locator: documentExcerptEvidenceLocatorSchema,
}).strict();

export const tableRegionCaptureSchema = z.object({
  requestedUrl: httpsUrlSchema,
  finalUrl: httpsUrlSchema,
  observedAt: z.string().datetime({ offset: true }),
  httpValidation: z.object({
    status: z.number().int().min(100).max(599),
    etag: z.string().min(1).max(1000).optional(),
    lastModified: z.string().min(1).max(1000).optional(),
  }).strict(),
  content: z.string().min(2),
  locator: tableRegionEvidenceLocatorSchema,
}).strict();

export type PublicWebTextCollectionInput = z.infer<typeof publicWebTextCollectionInputSchema>;
export type PublicWebTextCaptureInput = z.infer<typeof publicWebTextCaptureInputSchema>;
export type PublicWebTextCapture = z.infer<typeof publicWebTextCaptureSchema>;
export type EnergyLabelRecordCollectionInput = z.infer<typeof energyLabelRecordCollectionInputSchema>;
export type EnergyLabelRecordCaptureInput = z.infer<typeof energyLabelRecordCaptureInputSchema>;
export type DocumentExcerptCollectionInput = z.infer<typeof documentExcerptCollectionInputSchema>;
export type DocumentExcerptCaptureInput = z.infer<typeof documentExcerptCaptureInputSchema>;
export type DocumentExcerptCapture = z.infer<typeof documentExcerptCaptureSchema>;
export type CnisRegistryRowCollectionInput = z.infer<typeof cnisRegistryRowCollectionInputSchema>;
export type CnisRegistryRowCaptureInput = z.infer<typeof cnisRegistryRowCaptureInputSchema>;
export type TableRegionCapture = z.infer<typeof tableRegionCaptureSchema>;
