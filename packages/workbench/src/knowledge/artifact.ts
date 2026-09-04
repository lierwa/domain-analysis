import type { KnowledgeAiReview, KnowledgeArtifact, KnowledgeDecision, KnowledgeItem, KnowledgePack, KnowledgeRun } from "@domain-analysis/shared";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { assessAdmission, candidateIndex } from "./admission";
import { digest, KnowledgeProcessingError, loadBytes, sha256 } from "./storage";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("|", "\\|").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("\n", " ");
const filename = (value: string) => digest(value).slice(0, 24);

type SourceRow = { id: string; taskId: string; runId: string; snapshotId: string; assetId?: string;
  sha256: string; url: string; locator: string; capturedAt: string };
type CatalogRecord = { id: string; name: string; facts: { label: string; value: string; sourceIds: string[] }[];
  images: { label: string; path: string; sourceIds: string[] }[] };

export async function createArtifact(input: { pack: KnowledgePack; run: KnowledgeRun; items: KnowledgeItem[];
  decisions: KnowledgeDecision[]; aiReview?: KnowledgeAiReview; number: number; artifactPath: string; previous?: KnowledgeArtifact }) {
  const admission = assessAdmission(input.run, input.items, input.decisions, input.aiReview);
  if (admission.gaps.length) throw new KnowledgeProcessingError("invalid_input", admission.gaps.join("；"));
  const candidates = candidateIndex(input.items);
  const admitted = admission.candidates.filter(row => row.admitted).map(row => candidates.get(row.candidateId)!)
    .sort((a, b) => a.candidate.id.localeCompare(b.candidate.id));
  const root = input.pack.skillName;
  const files: Record<string, Uint8Array> = {};
  const sources = new Map<string, SourceRow>();
  const records = new Map<string, CatalogRecord>();
  for (const { candidate, item } of admitted) {
    const recordId = filename(`${item.input.ref.taskId}:${item.input.subjectKey}`);
    const record = records.get(recordId) ?? { id: recordId, name: item.input.subjectName, facts: [], images: [] };
    const sourceId = `source-${filename(candidate.id)}`;
    sources.set(sourceId, { id: sourceId, ...item.input.ref, url: item.input.url,
      locator: candidate.locator, capturedAt: item.input.capturedAt });
    if (candidate.kind === "text") mergeFact(record, candidate.label, candidate.text, sourceId);
    else {
      const path = `assets/images/${filename(candidate.id)}.png`;
      files[`${root}/${path}`] = await loadBytes(input.artifactPath, item.derivative!.sha256);
      record.images.push({ label: candidate.label, path, sourceIds: [sourceId] });
    }
    records.set(recordId, record);
  }
  const catalog = { schemaVersion: "1.0", skill: root, records: [...records.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) };
  const provenance = { schemaVersion: "1.0", production: { version: input.number, runId: input.run.id,
    inputHash: input.run.inputHash, toolVersion: input.run.toolVersion, reviewRevision: input.run.reviewRevision,
    batches: input.pack.selection }, sources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  files[`${root}/assets/data/catalog.json`] = json(catalog);
  files[`${root}/assets/data/provenance.json`] = json(provenance);
  files[`${root}/references/catalog.md`] = strToU8(catalogReference(catalog.records));
  files[`${root}/references/source-boundaries.md`] = strToU8(sourceBoundaries());
  files[`${root}/scripts/query.mjs`] = strToU8(queryScript());
  files[`${root}/scripts/validate.mjs`] = strToU8(validateScript());
  files[`${root}/SKILL.md`] = strToU8(skillInstructions(input.pack, catalog.records.length));
  const resources = Object.keys(files).sort().map((path, index) => ({ name: `skill-file-${index + 1}`, path,
    bytes: files[path]!.byteLength, hash: `sha256:${sha256(files[path]!)}`, mediatype: mediaType(path) }));
  const ordered: Zippable = Object.fromEntries(Object.keys(files).sort().map(key =>
    [key, [files[key]!, { mtime: new Date("2000-01-01T00:00:00Z") }]]));
  const zip = zipSync(ordered, { level: 6 });
  await validateArtifact(zip, resources, "agent-skill", root);
  const contentHashes = Object.fromEntries(admitted.map(({ candidate }) => [candidate.id, candidate.contentHash]));
  const previous = input.previous?.contentHashes ?? {};
  const artifact: KnowledgeArtifact = { format: "agent-skill", skillName: root, entrypoint: `${root}/SKILL.md`,
    sha256: sha256(zip), bytes: zip.byteLength, resources, accepted: admission.accepted,
    images: admission.images, quarantined: admission.quarantined, gaps: [], contentHashes,
    changes: { added: Object.keys(contentHashes).filter(id => !previous[id]).length,
      removed: Object.keys(previous).filter(id => !contentHashes[id]).length,
      modified: Object.keys(contentHashes).filter(id => previous[id] && previous[id] !== contentHashes[id]).length } };
  return { zip, artifact };
}

function mergeFact(record: CatalogRecord, label: string, value: string, sourceId: string) {
  const current = record.facts.find(fact => fact.label === label && fact.value === value);
  if (current) current.sourceIds.push(sourceId);
  else record.facts.push({ label, value, sourceIds: [sourceId] });
  record.facts.sort((a, b) => a.label.localeCompare(b.label, "zh-CN") || a.value.localeCompare(b.value, "zh-CN"));
}

function skillInstructions(pack: KnowledgePack, count: number) {
  const description = `Use when answering questions covered by ${pack.name}: ${pack.scope}`.slice(0, 1_024);
  return `---\nname: ${pack.skillName}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${escape(pack.name)}\n\n`
    + `Use this skill to retrieve source-backed knowledge within this scope: ${escape(pack.scope)}\n\n`
    + `## Workflow\n\n1. Run \`node scripts/query.mjs --query "<keywords>"\` before answering a factual question.\n`
    + `2. Use \`--subject\` for an exact entity and \`--field\` to narrow a property.\n`
    + `3. Preserve source wording, units, conditions, and the returned \`sourceIds\`.\n`
    + `4. Read [source boundaries](references/source-boundaries.md) before treating a source observation as a general conclusion.\n`
    + `5. Use images only from the returned \`images\` entries; those paths point to reviewed derivatives.\n\n`
    + `## Resources\n\n- [Catalog guide](references/catalog.md) lists ${count} knowledge records.\n`
    + `- \`assets/data/catalog.json\` is the queryable knowledge source.\n`
    + `- \`assets/data/provenance.json\` contains immutable source lineage and production hashes.\n`
    + `- Run \`node scripts/validate.mjs\` after copying or unpacking this skill.\n`;
}

function catalogReference(records: CatalogRecord[]) {
  const rows = records.map(record => `| ${escape(record.id)} | ${escape(record.name)} | ${record.facts.length} | ${record.images.length} |`);
  return `# Catalog guide\n\nUse \`../scripts/query.mjs\` to read full facts and their source IDs.\n\n`
    + `| Record ID | Name | Facts | Images |\n| --- | --- | ---: | ---: |\n${rows.join("\n")}\n`;
}

function sourceBoundaries() {
  return `# Source and use boundaries\n\n- Catalog values are observations preserved from the cited source snapshots.\n`
    + `- Keep the original unit, qualifier, and applicable condition when using a value.\n`
    + `- Different values for the same entity and field require an explicit resolution before release.\n`
    + `- Missing data means the selected sources did not provide a reviewed value; do not infer one.\n`
    + `- Images in this skill are reviewed derivatives. Do not use source images absent from the catalog.\n`;
}

function queryScript() {
  return `import fs from "node:fs";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\n\n`
    + `const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");\n`
    + `const catalog = JSON.parse(fs.readFileSync(path.join(root, "assets", "data", "catalog.json"), "utf8"));\n`
    + `const args = new Map(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1] ?? "");\n`
    + `const norm = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase();\n`
    + `const query = norm(args.get("--query")); const subject = norm(args.get("--subject")); const field = norm(args.get("--field"));\n`
    + `const limit = Math.max(1, Math.min(100, Number(args.get("--limit") || 20)));\n`
    + `const records = catalog.records.filter(record => !subject || norm(record.name) === subject).map(record => ({ ...record,\n`
    + `  facts: record.facts.filter(fact => (!field || norm(fact.label).includes(field)) && (!query || norm([record.name, fact.label, fact.value].join(" ")).includes(query))),\n`
    + `  images: record.images.filter(image => !query || norm([record.name, image.label].join(" ")).includes(query))\n`
    + `})).filter(record => record.facts.length || record.images.length).slice(0, limit);\n`
    + `process.stdout.write(JSON.stringify({ query: Object.fromEntries(args), count: records.length, records }, null, 2) + "\\n");\n`;
}

function validateScript() {
  return `import fs from "node:fs";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\n\n`
    + `const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");\n`
    + `const required = ["SKILL.md", "references/catalog.md", "references/source-boundaries.md", "assets/data/catalog.json", "assets/data/provenance.json", "scripts/query.mjs"];\n`
    + `for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error("Missing skill file: " + file);\n`
    + `const catalog = JSON.parse(fs.readFileSync(path.join(root, "assets/data/catalog.json"), "utf8"));\n`
    + `const provenance = JSON.parse(fs.readFileSync(path.join(root, "assets/data/provenance.json"), "utf8"));\n`
    + `const sources = new Set(provenance.sources.map(source => source.id));\n`
    + `for (const record of catalog.records) for (const entry of [...record.facts, ...record.images]) {\n`
    + `  if (entry.sourceIds.some(id => !sources.has(id))) throw new Error("Unknown source ID in " + record.id);\n`
    + `  if (entry.path && !fs.existsSync(path.join(root, entry.path))) throw new Error("Missing image: " + entry.path);\n}\n`
    + `process.stdout.write(JSON.stringify({ valid: true, records: catalog.records.length, sources: sources.size }) + "\\n");\n`;
}

const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
const mediaType = (path: string) => path.endsWith(".png") ? "image/png" : path.endsWith(".json")
  ? "application/json" : path.endsWith(".mjs") ? "text/javascript" : "text/markdown";

export async function validateArtifact(bytes: Uint8Array, resources: KnowledgeArtifact["resources"],
  format: KnowledgeArtifact["format"] = "agent-skill", skillName?: string) {
  const files = unzipSync(bytes);
  const paths = resources.map(row => row.path);
  if (new Set(paths).size !== paths.length) throw new KnowledgeProcessingError("invalid_input", "成品文件路径重复");
  if (format === "data-package-2") return files;
  if (!skillName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new KnowledgeProcessingError("invalid_input", "Skill 标识不符合规范");
  }
  if (digest(Object.keys(files).sort()) !== digest(paths.sort())) {
    throw new KnowledgeProcessingError("invalid_input", "Skill 文件与版本资源清单不一致");
  }
  for (const resource of resources) {
    const content = files[resource.path];
    if (!resource.path.startsWith(`${skillName}/`) || resource.path.includes("..") || !content
      || content.byteLength !== resource.bytes || `sha256:${sha256(content)}` !== resource.hash) {
      throw new KnowledgeProcessingError("invalid_input", "Skill 资源路径或内容哈希校验失败");
    }
  }
  const skill = Buffer.from(files[`${skillName}/SKILL.md`] ?? []).toString("utf8");
  const frontmatter = skill.match(/^---\n([\s\S]+?)\n---\n/);
  if (!frontmatter || !frontmatter[1]!.includes(`name: ${skillName}`) || !frontmatter[1]!.includes("description:")) {
    throw new KnowledgeProcessingError("invalid_input", "SKILL.md 缺少标准 name 或 description 元数据");
  }
  const catalog = JSON.parse(Buffer.from(files[`${skillName}/assets/data/catalog.json`] ?? []).toString("utf8"));
  const provenance = JSON.parse(Buffer.from(files[`${skillName}/assets/data/provenance.json`] ?? []).toString("utf8"));
  if (!Array.isArray(catalog.records) || !Array.isArray(provenance.sources)) {
    throw new KnowledgeProcessingError("invalid_input", "Skill 结构化数据未通过校验");
  }
  return files;
}
