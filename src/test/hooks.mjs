import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = pathToFileURL(srcDir.endsWith(sep) ? srcDir : srcDir + sep).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(`${specifier.slice(2)}.ts`, srcRoot).href, context);
  }
  return nextResolve(specifier, context);
}
