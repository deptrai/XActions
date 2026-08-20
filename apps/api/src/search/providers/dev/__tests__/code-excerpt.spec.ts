import { describe, it, expect } from 'vitest';
import { toCodeExcerpt } from '../code-excerpt';
import { Chunk } from '@chainlens/types';

describe('toCodeExcerpt', () => {
  const createMockChunk = (content: string, meta: Record<string, unknown> = {}): Chunk => ({
    content,
    metadata: {
      source: 'stackoverflow',
      sourceId: '12345',
      domain: 'stackoverflow.com',
      fetchedAt: new Date().toISOString(),
      contentType: 'text/markdown',
      ...meta,
    },
  });

  it('Scenario 1: should return chunk intact when content length is within maxTokens budget', () => {
    const shortContent = 'This is a short code snippet and explanation that fits in budget.';
    const chunk = createMockChunk(shortContent);

    const result = toCodeExcerpt(chunk, 512);

    expect(result.content).toBe(shortContent);
    expect(result.metadata.excerpted).toBeUndefined();
    expect(result.metadata.originalContentLength).toBeUndefined();
  });

  it('Scenario 2: should prioritize fenced code blocks and truncate prose when exceeding budget', () => {
    const codeBlock1 = '```typescript\nconst a: number = 1;\nconsole.log(a);\n```';
    const codeBlock2 = '```typescript\nfunction add(x: number, y: number): number {\n  return x + y;\n}\n```';
    const longProse = 'A'.repeat(5000);
    const content = `# Introduction\n\n${longProse}\n\n${codeBlock1}\n\nMore long prose: ${longProse}\n\n${codeBlock2}\n\nEnd notes.`;
    const chunk = createMockChunk(content);

    const result = toCodeExcerpt(chunk, 128); // 128 tokens = ~512 chars

    expect(result.content).toContain(codeBlock1);
    expect(result.content).toContain(codeBlock2);
    expect(result.content.length).toBeLessThan(content.length);
    expect(result.content).toContain('…[truncated]');
    expect(result.metadata.excerpted).toBe(true);
    expect(result.metadata.originalContentLength).toBe(content.length);
  });

  it('Scenario 3: should truncate long content without code blocks at maxTokens*4 and append truncation indicator', () => {
    const longProse = 'Here is a long explanation without any code blocks at all. '.repeat(50);
    const chunk = createMockChunk(longProse);

    const maxTokens = 64; // 256 chars budget
    const result = toCodeExcerpt(chunk, maxTokens);

    expect(result.content.length).toBeLessThanOrEqual(maxTokens * 4 + 20); // allow for \n…[truncated]
    expect(result.content).toContain('…[truncated]');
    expect(result.metadata.excerpted).toBe(true);
    expect(result.metadata.originalContentLength).toBe(longProse.length);
  });

  it('Scenario 4: should handle single line code block within very small budget', () => {
    const content = `Some lead-in text.\n\`\`\`bash\nnpm install\n\`\`\`\nSome very long trailing explanations that will not fit in 8 tokens budget. ${'x'.repeat(200)}`;
    const chunk = createMockChunk(content);

    const result = toCodeExcerpt(chunk, 8); // 32 chars budget

    expect(result.content).toContain('npm install');
    expect(result.metadata.excerpted).toBe(true);
  });

  it('Scenario 5: should preserve opening fence with language tag and closing fence for code blocks', () => {
    const code = '```typescript\ninterface User {\n  id: string;\n  name: string;\n}\n```';
    const content = `# TypeScript Interfaces\n${'Detailed background history of TypeScript interfaces. '.repeat(20)}\n${code}\n${'More trailing text. '.repeat(20)}`;
    const chunk = createMockChunk(content);

    const result = toCodeExcerpt(chunk, 30); // ~120 chars

    expect(result.content).toMatch(/```typescript\ninterface User {[\s\S]*?}\n```/);
    expect(result.metadata.excerpted).toBe(true);
  });

  it('should preserve original metadata properties when excerpting', () => {
    const content = '```python\nprint("hello")\n```\n' + 'y'.repeat(1000);
    const chunk = createMockChunk(content, {
      title: 'Python hello world',
      url: 'https://example.com/python',
      score: 42,
      author: 'dev-user',
    });

    const result = toCodeExcerpt(chunk, 32);

    expect(result.metadata.title).toBe('Python hello world');
    expect(result.metadata.url).toBe('https://example.com/python');
    expect(result.metadata.score).toBe(42);
    expect(result.metadata.author).toBe('dev-user');
    expect(result.metadata.excerpted).toBe(true);
    expect(result.metadata.originalContentLength).toBe(content.length);
  });
});
