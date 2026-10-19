/** Minimal terminal styling. Respects NO_COLOR, FORCE_COLOR and non-TTY output (pipes, files, CI). */
const enabled =
  process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0"
    ? true
    : !process.env.NO_COLOR && process.stdout.isTTY === true && (process.stdout.hasColors?.() ?? false);

const wrap = (open: number, close: number) => (s: string) => (enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s);

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const violet = (s: string) => (enabled ? `\u001b[38;5;141m${s}\u001b[39m` : s);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const red = wrap(31, 39);

export function width(): number {
  return Math.min(process.stdout.columns || 80, 100);
}

export function rule(): string {
  return dim("─".repeat(width()));
}

/** Wraps text to the terminal width with an indent, without breaking words. */
export function wrapText(text: string, indent = 2): string {
  const max = width() - indent;
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > max) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out.map((l) => " ".repeat(indent) + l).join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Margaux's voice in a terminal: each word appears faint, then sharp, a beat apart,
 * wrapped at the terminal width. Plain text when colours are off or output is piped.
 */
export async function streamWords(text: string, out: NodeJS.WriteStream = process.stdout, indent = 2): Promise<void> {
  if (!enabled) {
    out.write(`${" ".repeat(indent)}${text}\n`);
    return;
  }
  const max = width() - 2;
  let col = indent;
  out.write(" ".repeat(indent));
  for (const word of text.split(" ").filter(Boolean)) {
    if (col + word.length + 1 > max) {
      out.write(`\n${" ".repeat(indent)}`);
      col = indent;
    }
    out.write(dim(word));
    await sleep(45);
    out.write(`\u001b[${word.length}D${word} `);
    col += word.length + 1;
    await sleep(55 + word.length * 12 + (/[.?…!]$/.test(word) ? 220 : 0));
  }
  out.write("\n");
}

export const colours = enabled;
