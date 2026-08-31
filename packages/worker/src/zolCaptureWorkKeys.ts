import type { SourceCaptureWorkItem } from "@domain-analysis/shared";

export type ZolCaptureWorkKey =
  | { kind: "brand_catalog"; brandKey: string; page: number }
  | { kind: "model_bundle"; brandKey: string; modelId: string }
  | { kind: "parameters"; modelId: string }
  | { kind: "gallery"; modelId: string }
  | { kind: "picture_set"; modelId: string; ordinal: number }
  | { kind: "image"; modelId: string; ordinal: number };

export function zolBrandCatalogWorkKey(brandKey: string, page: number) {
  return `page:brand:${brandKey}:${page}`;
}

export function zolModelBundleWorkKey(brandKey: string, modelId: string) {
  return `model:${brandKey}:${modelId}`;
}

export function zolParameterWorkKey(modelId: string) { return `page:param:${modelId}`; }
export function zolGalleryWorkKey(modelId: string) { return `page:gallery:${modelId}`; }
export function zolPictureSetWorkKey(modelId: string, ordinal: number) {
  return `page:image-set:${modelId}:${ordinal}`;
}
export function zolImageWorkKey(modelId: string, ordinal: number) {
  return `asset:image:${modelId}:${ordinal}`;
}

export function parseZolCaptureWorkKey(value: string): ZolCaptureWorkKey | undefined {
  const brand = /^page:brand:([a-z0-9-]+):(\d+)$/i.exec(value);
  if (brand?.[1] && brand[2]) return { kind: "brand_catalog", brandKey: brand[1].toLowerCase(),
    page: Number(brand[2]) };
  const model = /^model:([a-z0-9-]+):(\d+)$/i.exec(value);
  if (model?.[1] && model[2]) return { kind: "model_bundle", brandKey: model[1].toLowerCase(),
    modelId: model[2] };
  const parameter = /^page:param:(\d+)$/.exec(value);
  if (parameter?.[1]) return { kind: "parameters", modelId: parameter[1] };
  const gallery = /^page:gallery:(\d+)$/.exec(value);
  if (gallery?.[1]) return { kind: "gallery", modelId: gallery[1] };
  const pictureSet = /^page:image-set:(\d+):(\d+)$/.exec(value);
  if (pictureSet?.[1] && pictureSet[2]) return { kind: "picture_set", modelId: pictureSet[1],
    ordinal: Number(pictureSet[2]) };
  const image = /^asset:image:(\d+):(\d+)$/.exec(value);
  if (image?.[1] && image[2]) return { kind: "image", modelId: image[1], ordinal: Number(image[2]) };
  return undefined;
}

export function zolResourceKindForWorkKey(value: string): SourceCaptureWorkItem["resourceKind"] {
  return parseZolCaptureWorkKey(value)?.kind;
}

export function zolModelWorkKey(brand: { key: string }, model: { id: string }) {
  return zolModelBundleWorkKey(brand.key, model.id);
}

export function zolBrandSubject(key: string) {
  return { kind: "brand" as const, sourceEntityId: key, displayName: key };
}

export function zolModelSubject(brand: { key: string }, model: { id: string; name: string }) {
  return { kind: "product_model" as const, sourceEntityId: model.id, displayName: model.name,
    parent: zolBrandSubject(brand.key) };
}

export function zolBrandLineage(catalogUrl: URL, key: string, page: number) {
  return page === 1
    ? { workKey: zolBrandCatalogWorkKey(key, page), discoveryKind: "planned_entry" as const, depth: 0 as const }
    : { workKey: zolBrandCatalogWorkKey(key, page), discoveryKind: "html_link" as const,
      depth: 1 as const, parentUrl: catalogUrl.href };
}

export function zolParameterLineage(brand: { catalogUrl: URL }, model: { id: string }) {
  return { workKey: zolParameterWorkKey(model.id), discoveryKind: "html_link" as const,
    depth: 1 as const, parentUrl: brand.catalogUrl.href };
}

export function zolGalleryLineage(parameterUrl: URL, model: { id: string }) {
  return { workKey: zolGalleryWorkKey(model.id), discoveryKind: "html_link" as const,
    depth: 2 as const, parentUrl: parameterUrl.href };
}

export function zolPictureSetLineage(galleryUrl: URL, model: { id: string }, ordinal: number) {
  return { workKey: zolPictureSetWorkKey(model.id, ordinal), discoveryKind: "html_link" as const,
    depth: 2 as const, parentUrl: galleryUrl.href };
}

export function zolImageLineage(detailUrl: URL, model: { id: string }, ordinal: number) {
  return { workKey: zolImageWorkKey(model.id, ordinal), discoveryKind: "html_link" as const,
    depth: 3 as const, parentUrl: detailUrl.href };
}
