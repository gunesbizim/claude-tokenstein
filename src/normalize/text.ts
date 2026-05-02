export function normalizePromptText(input: string): string {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let blankRun = 0;

  for (const line of lines) {
    const trimmedForFence = line.trim();
    const isFence = /^```/.test(trimmedForFence);

    if (isFence) {
      inFence = !inFence;
      out.push(line);
      blankRun = 0;
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    const collapsed = line.replace(/[ \t]+/g, " ").trim();
    if (collapsed === "") {
      blankRun++;
      if (blankRun <= 1) out.push("");
    } else {
      blankRun = 0;
      out.push(collapsed);
    }
  }

  return out.join("\n").trim();
}
