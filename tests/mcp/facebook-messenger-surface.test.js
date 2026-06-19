// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// XActions — Story 5.4 messenger-share surface tests (MCP) + schema additivity.
// by nichxbt
//
// Covers:
//   - x_facebook_automate schema is additively extended (messenger enum +
//     recipients/content/postUrl props) WITHOUT removing like/comment/post.
//   - MCP messenger action pre-browser validation (postUrl/recipients/content).
//   - Dry-run messenger launches NO browser (dispatch(null) short-circuit) and
//     returns the runGuardedBatch preview shape.
//   - Privacy (NFR3): recipients/content are not echoed in thrown error messages.
//
// No real browser is launched — every tested path either throws before the first
// Puppeteer await, or runs the dry-run branch (which never touches the DOM).

import { describe, it, expect } from 'vitest';
import { executeFacebookAutomateTool, TOOLS } from '../../src/mcp/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_AUTH = { c_user: 'u_12345', xs: 'xs_token_abc' };
const VALID_POST = 'https://www.facebook.com/post/123';
const VALID_RECIPIENTS = ['Page Alpha', 'Page Beta'];
const VALID_CONTENT = 'Check this out **also this variant';

const findTool = (name) => TOOLS.find((t) => t.name === name);
const automateSchema = () => findTool('x_facebook_automate')?.inputSchema;

// ===========================================================================
// Schema additivity — messenger added, originals intact (AC #11, #22)
// ===========================================================================

describe('x_facebook_automate schema — messenger additive extension', () => {
  it('action enum still contains like, comment, post', () => {
    const en = automateSchema()?.properties?.action?.enum ?? [];
    expect(en).toContain('like');
    expect(en).toContain('comment');
    expect(en).toContain('post');
  });

  it('action enum adds messenger', () => {
    const en = automateSchema()?.properties?.action?.enum ?? [];
    expect(en).toContain('messenger');
  });

  it('adds recipients array field', () => {
    const recipients = automateSchema()?.properties?.recipients;
    expect(recipients?.type).toBe('array');
    expect(recipients?.items?.type).toBe('string');
  });

  it('adds content string field', () => {
    expect(automateSchema()?.properties?.content?.type).toBe('string');
  });

  it('adds postUrl string field', () => {
    expect(automateSchema()?.properties?.postUrl?.type).toBe('string');
  });

  it('preserves existing urls/text/dryRun/authCookie/maxBatch fields', () => {
    const props = automateSchema()?.properties ?? {};
    expect(props.urls?.type).toBe('array');
    expect(props.text?.type).toBe('string');
    expect(props.dryRun?.type).toBe('boolean');
    expect(props.authCookie?.properties).toHaveProperty('c_user');
    expect(props.authCookie?.properties).toHaveProperty('xs');
    expect(props.maxBatch?.type).toBe('number');
  });

  it('required array is unchanged (action + authCookie only)', () => {
    const required = automateSchema()?.required ?? [];
    expect(required).toContain('action');
    expect(required).toContain('authCookie');
    expect(required).not.toContain('recipients');
    expect(required).not.toContain('postUrl');
  });
});

// ===========================================================================
// MCP messenger validation — fires BEFORE browser launch (AC #12)
// ===========================================================================

describe('executeFacebookAutomateTool — messenger auth guard', () => {
  it('throws when authCookie is absent (auth guard runs first)', async () => {
    await expect(
      executeFacebookAutomateTool({
        action: 'messenger', postUrl: VALID_POST,
        recipients: VALID_RECIPIENTS, content: VALID_CONTENT,
      })
    ).rejects.toThrow(/requires authCookie/i);
  });
});

describe('executeFacebookAutomateTool — messenger arg validation', () => {
  it('throws when postUrl is missing', async () => {
    await expect(
      executeFacebookAutomateTool({
        action: 'messenger', authCookie: VALID_AUTH,
        recipients: VALID_RECIPIENTS, content: VALID_CONTENT,
      })
    ).rejects.toThrow(/facebook\.com postUrl/i);
  });

  it('throws when postUrl is not a facebook.com URL', async () => {
    await expect(
      executeFacebookAutomateTool({
        action: 'messenger', authCookie: VALID_AUTH,
        postUrl: 'https://twitter.com/x/1',
        recipients: VALID_RECIPIENTS, content: VALID_CONTENT,
      })
    ).rejects.toThrow(/facebook\.com postUrl/i);
  });

  it('throws when recipients is an empty array', async () => {
    await expect(
      executeFacebookAutomateTool({
        action: 'messenger', authCookie: VALID_AUTH,
        postUrl: VALID_POST, recipients: [], content: VALID_CONTENT,
      })
    ).rejects.toThrow(/non-empty recipients/i);
  });

  it('throws when recipients is absent (destructure default [])', async () => {
    await expect(
      executeFacebookAutomateTool({
        action: 'messenger', authCookie: VALID_AUTH,
        postUrl: VALID_POST, content: VALID_CONTENT,
      })
    ).rejects.toThrow(/non-empty recipients/i);
  });

  it('throws when content is empty / whitespace', async () => {
    await expect(
      executeFacebookAutomateTool({
        action: 'messenger', authCookie: VALID_AUTH,
        postUrl: VALID_POST, recipients: VALID_RECIPIENTS, content: '   ',
      })
    ).rejects.toThrow(/non-empty content/i);
  });
});

// ===========================================================================
// Privacy (NFR3) — validation errors never echo recipients/content (AC #21)
// ===========================================================================

describe('executeFacebookAutomateTool — messenger privacy in errors', () => {
  it('postUrl error message does not leak recipients or content', async () => {
    const SECRET_RECIPIENT = 'SuperSecretPage12345';
    const SECRET_CONTENT = 'TopSecretMessageBody';
    const err = await executeFacebookAutomateTool({
      action: 'messenger', authCookie: VALID_AUTH,
      postUrl: 'https://twitter.com/not-fb',
      recipients: [SECRET_RECIPIENT], content: SECRET_CONTENT,
    }).catch((e) => e);
    expect(err.message).not.toContain(SECRET_RECIPIENT);
    expect(err.message).not.toContain(SECRET_CONTENT);
  });
});

// ===========================================================================
// Dry-run — NO browser launch, returns preview shape (AC #13, #20)
// ===========================================================================

describe('executeFacebookAutomateTool — messenger dry-run (no browser)', () => {
  it('omitting dryRun defaults to dry-run and returns preview without launching a browser', async () => {
    const result = await executeFacebookAutomateTool({
      action: 'messenger', authCookie: VALID_AUTH,
      postUrl: VALID_POST, recipients: VALID_RECIPIENTS, content: VALID_CONTENT,
    });
    // runGuardedBatch dry-run shape: dryRun true, no real attempts, preview present.
    expect(result.dryRun).toBe(true);
    expect(result.attempted).toBe(0);
    expect(Array.isArray(result.preview)).toBe(true);
    // one preview entry per recipient (campaign broadcast)
    expect(result.preview).toHaveLength(VALID_RECIPIENTS.length);
  });

  it('explicit dryRun:true behaves identically (no browser)', async () => {
    const result = await executeFacebookAutomateTool({
      action: 'messenger', authCookie: VALID_AUTH, dryRun: true,
      postUrl: VALID_POST, recipients: VALID_RECIPIENTS, content: VALID_CONTENT,
    });
    expect(result.dryRun).toBe(true);
    expect(result.attempted).toBe(0);
  });
});
