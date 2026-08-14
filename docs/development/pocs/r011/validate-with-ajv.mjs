import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const schema = readJson("knowledge-claims.schema.json");
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

const results = process.argv.slice(2).map((fileName) => {
  const valid = validate(readJson(fileName));
  return {
    file: fileName,
    valid,
    errors: valid ? [] : structuredClone(validate.errors ?? []),
  };
});

console.log(JSON.stringify(results, null, 2));
process.exitCode = results.every((result) => result.valid) ? 0 : 1;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(currentDirectory, fileName), "utf8"));
}
