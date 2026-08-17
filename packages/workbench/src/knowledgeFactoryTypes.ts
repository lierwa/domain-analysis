import type {
  EvidenceRequest,
  KnowledgeClaimCandidateDraft,
  KnowledgeSubject,
  SourceObservation,
} from "@domain-analysis/shared";

export type RunKnowledgeFactory = import("@domain-analysis/shared").RunKnowledgeFactoryInput;

export interface KnowledgeCandidateModelInput {
  projectId: string;
  categoryDefinitionVersionId: string;
  recipeVersion: string;
  category: { code: string; label: string };
  materials: Array<{
    knowledgeNeedId: string;
    question: string;
    knowledgeLayer: EvidenceRequest["knowledgeLayer"];
    subjects: KnowledgeSubject[];
    evidence: Array<{
      id: string;
      content: string;
      sourceIdentity: string;
      sourceAuthorityType: SourceObservation["sourceAuthorityType"];
    }>;
  }>;
}

export interface KnowledgeCandidateModelPort {
  propose(input: KnowledgeCandidateModelInput): Promise<KnowledgeClaimCandidateDraft[]>;
}

export interface KnowledgeFactoryModuleOptions {
  now?: () => Date;
  candidateModel?: KnowledgeCandidateModelPort;
}
