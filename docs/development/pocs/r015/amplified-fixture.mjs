import { knowledgePackageSchema } from "./package-fixture.mjs";

export function amplifyKnowledgePackage(source, productCount = 1000) {
  const products = [];
  const claims = [];
  for (let index = 0; index < productCount; index += 1) {
    const template = source.products[index % source.products.length];
    const copy = Math.floor(index / source.products.length);
    const suffix = copy === 0 ? "" : `:scale-${copy}`;
    const productId = `${template.productId}${suffix}`;
    products.push({
      ...template,
      productId,
      model: copy === 0 ? template.model : `${template.model}-S${copy}`,
      aliases: copy === 0 ? template.aliases : template.aliases.map((alias) => `${alias} 样本${copy}`),
    });
    const templateClaims = source.claims.filter((claim) => claim.productId === template.productId);
    claims.push(...templateClaims.map((claim) => ({
      ...claim,
      claimId: `${claim.claimId}${suffix}`,
      productId,
    })));
  }
  // WHY：放大样本只测存储规模，不伪装成市场覆盖数据；所有证据定位继续明确标记 fixture。
  return knowledgePackageSchema.parse({
    ...source,
    packageVersion: `${source.packageVersion}-scale-${productCount}`,
    products,
    claims,
  });
}
