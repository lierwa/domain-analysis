import { createRawContentRepository, createRunReportRepository, type AppDb } from "@domain-analysis/db";

// WHY: ContentService 聚合所有 run 内容查询，单一职责，不与 run 状态管理混用。

export function createContentService(db: AppDb) {
  const contentRepo = createRawContentRepository(db);
  const reportRepo = createRunReportRepository(db);

  return {
    // WHY: 内容查询必须带 runId，禁止返回全局混杂内容。
    async listRunContents(
      runId: string,
      page: number,
      pageSize: number,
      filters: { search?: string; author?: string; publishedFrom?: string; publishedTo?: string } = {}
    ) {
      return contentRepo.listByRunPage(runId, { page, pageSize }, filters);
    },

    async listReports(page: number, pageSize: number, filters: { projectId?: string } = {}) {
      return reportRepo.listPage({ page, pageSize }, filters);
    },

    async getReport(id: string) {
      return reportRepo.getById(id);
    }
  };
}
