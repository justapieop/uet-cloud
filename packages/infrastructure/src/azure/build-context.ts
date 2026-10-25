import { mkdtemp, mkdir, writeFile, readFile, realpath, stat, rm } from "node:fs/promises";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, sep } from "node:path";
import { c, x, type ReadEntry } from "tar";
import { InvalidBuildInput } from "@kumo/application";

export async function prepareBuildContext(archive: Uint8Array, dockerFilePath: string): Promise<Buffer> {
  const temporary: string = await mkdtemp(join(tmpdir(), "kumo-build-"));
  try {
    const source: string = join(temporary, "source");
    const input: string = join(temporary, "github.tar.gz");
    const output: string = join(temporary, "context.tar.gz");
    await mkdir(source);
    await writeFile(input, archive);
    let extractedSize: number = 0;
    let tooLarge: boolean = false;
    // GitHub adds an owner-repository-SHA directory. Remove it so Dockerfile
    // and COPY paths are relative to the repository root.
    await x({
      file: input, cwd: source, strip: 1, strict: true,
      filter: (_path: string, entry: ReadEntry | Stats): boolean => {
        extractedSize += entry.size;
        if (extractedSize > 256 * 1024 * 1024) tooLarge = true;
        return !tooLarge;
      },
    });
    if (tooLarge) throw new InvalidBuildInput("Extracted repository exceeds the 256 MiB build source limit");
    let dockerfile: string;
    try {
      dockerfile = await realpath(join(source, dockerFilePath));
    } catch {
      throw new InvalidBuildInput("Dockerfile was not found at the specified path");
    }
    // Canonicalize both sides: Windows runners can expose TEMP through a junction.
    const sourceRoot: string = await realpath(source);
    const relativePath: string = relative(sourceRoot, dockerfile);
    if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`) || !(await stat(dockerfile)).isFile()) {
      throw new InvalidBuildInput("Dockerfile must be a file inside the repository");
    }
    await c({ file: output, cwd: source, gzip: true, portable: true }, ["."]);
    return await readFile(output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
