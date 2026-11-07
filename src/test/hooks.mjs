import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = pathToFileURL(srcDir.endsWith(sep) ? srcDir : srcDir + sep).href;

// "@/x/y" is src/x/y.ts, or src/x/y/index.ts for a folder module (Next and TypeScript resolve both).
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const path = specifier.slice(2);
    try {
      return await nextResolve(new URL(`${path}.ts`, srcRoot).href, context);
    } catch (error) {
      if (error && error.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(new URL(`${path}/index.ts`, srcRoot).href, context);
      }
      throw error;
    }
  }
  return nextResolve(specifier, context);
}
