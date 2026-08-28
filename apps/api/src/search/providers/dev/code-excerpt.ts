import { Chunk } from '@chainlens/types';

/**
 * Story 48-2 (AC2): toCodeExcerpt helper for token-efficient code context.
 * Heuristically estimates tokens as Math.ceil(content.length / 4).
 * If length exceeds maxTokens * 4:
 * 1. Extracts fenced code blocks (``` ... ```)
 * 2. Extracts markdown headings (# ...)
 * 3. Appends inline code and prose up to maxTokens budget
 * 4. Appends truncation marker "\n…[truncated]"
 */
export function toCodeExcerpt(chunk: Chunk, maxTokens: number): Chunk {
  const content = chunk.content ?? '';
  const maxChars = Math.max(1, maxTokens * 4);

  // If already within token budget, return unchanged
  if (Math.ceil(content.length / 4) <= maxTokens) {
    return chunk;
  }

  // Extract fenced code blocks
  const codeBlockRegex = /(?:^|\n)(```[^\n]*\r?\n[\s\S]*?\r?\n```)/g;
  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match[1]) {
      codeBlocks.push(match[1].trim());
    }
  }

  let accumulated = '';

  if (codeBlocks.length > 0) {
    // Append code blocks first
    for (const block of codeBlocks) {
      if (accumulated.length + block.length + 2 <= maxChars) {
        accumulated += (accumulated ? '\n\n' : '') + block;
      } else {
        // Truncate within code block if no blocks added yet or partial fits
        const remainingChars = maxChars - accumulated.length - 2;
        if (remainingChars > 30) {
          accumulated += (accumulated ? '\n\n' : '') + block.slice(0, remainingChars);
        }
        break;
      }
    }
  }

  // If budget remains, extract headings and prose
  if (accumulated.length < maxChars) {
    const lines = content.split(/\r?\n/);
    const headings: string[] = [];
    const proseLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('```')) continue;
      if (/^#{1,6}\s/.test(trimmed)) {
        headings.push(trimmed);
      } else {
        proseLines.push(trimmed);
      }
    }

    // Add headings if budget allows
    for (const h of headings) {
      if (accumulated.length + h.length + 2 <= maxChars) {
        accumulated = (accumulated ? accumulated + '\n\n' : '') + h;
      } else {
        break;
      }
    }

    // Add prose if budget still allows
    for (const p of proseLines) {
      if (accumulated.length + p.length + 2 <= maxChars) {
        accumulated = (accumulated ? accumulated + '\n\n' : '') + p;
      } else {
        const remaining = maxChars - accumulated.length - 2;
        if (remaining > 10) {
          accumulated = (accumulated ? accumulated + '\n\n' : '') + p.slice(0, remaining);
        }
        break;
      }
    }
  }

  // Fallback if regex/split resulted in empty string (e.g. malformed blocks)
  if (!accumulated) {
    accumulated = content.slice(0, maxChars);
  }

  const excerptedContent = accumulated.trimEnd() + '\n…[truncated]';

  return {
    ...chunk,
    content: excerptedContent,
    metadata: {
      ...chunk.metadata,
      excerpted: true,
      originalContentLength: content.length,
    },
  };
}
