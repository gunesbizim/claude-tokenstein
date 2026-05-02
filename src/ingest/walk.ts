import { homedir } from "node:os";
import { opendir } from "node:fs/promises";
import { join } from "node:path";

export async function* globProjects(): AsyncIterable<string> {
  const root = join(homedir(), ".claude", "projects");
  let projectsDir;
  try {
    projectsDir = await opendir(root);
  } catch {
    return;
  }
  for await (const projectEntry of projectsDir) {
    if (!projectEntry.isDirectory()) continue;
    const projectPath = join(root, projectEntry.name);
    let projectDir;
    try {
      projectDir = await opendir(projectPath);
    } catch {
      continue;
    }
    for await (const fileEntry of projectDir) {
      if (fileEntry.isFile() && fileEntry.name.endsWith(".jsonl")) {
        yield join(projectPath, fileEntry.name);
      }
    }
  }
}
