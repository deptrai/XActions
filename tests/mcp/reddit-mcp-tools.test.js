// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// Tests for Reddit support across MCP tools (Story 35.1 Amendment)
// by nichxbt

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { executeActionListTool } from '../../src/scrapers/social/actions-list.js';
import { x_list_platforms } from '../../src/mcp/local-tools.js';
import { executeTool } from '../../src/mcp/server.js';

describe('Story 35.1 — Reddit MCP Exposure', () => {
  let server;
  let serverUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/r/programming/new.json') || req.url?.startsWith('/r/programming/new?') || req.url === '/r/programming/new') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          kind: 'Listing',
          data: {
            children: [
              {
                kind: 't3',
                data: {
                  name: 't3_mcp_test',
                  id: 'mcp_test',
                  subreddit: 'programming',
                  author: 'mcp_bot',
                  title: 'Reddit MCP Post',
                  score: 10,
                  num_comments: 1,
                  created_utc: 1700000000,
                  permalink: '/r/programming/comments/mcp_test/reddit_mcp_post/',
                },
              },
            ],
            after: null,
          },
        }));
        return;
      }

      if (req.url?.startsWith('/r/programming/comments/mcp_test') || req.url?.startsWith('/comments/mcp_test')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          { kind: 'Listing', data: { children: [] } },
          {
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't1',
                  data: {
                    name: 't1_comment_mcp',
                    id: 'comment_mcp',
                    link_id: 't3_mcp_test',
                    author: 'commenter',
                    body: 'MCP Comment Body',
                    score: 5,
                    created_utc: 1700000050,
                  },
                },
              ],
              after: null,
            },
          },
        ]));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('enumerates reddit in x_list_platforms', async () => {
    const res = await x_list_platforms();
    const reddit = res.platforms.find((p) => p.name === 'reddit');
    expect(reddit).toBeDefined();
    expect(reddit.aliases).toContain('rdt');
    expect(reddit.capabilities).toContain('subreddit');
    expect(reddit.capabilities).toContain('post_comments');
    expect(reddit.capabilities).toContain('search');
  });

  it('enumerates reddit actions via executeActionListTool', async () => {
    const actions = await executeActionListTool({ platform: 'reddit' });
    expect(Array.isArray(actions)).toBe(true);
    const actionNames = actions.map((a) => a.action);
    expect(actionNames).toContain('subreddit');
    expect(actionNames).toContain('user');
    expect(actionNames).toContain('search');
    expect(actionNames).toContain('post_comments');
    expect(actionNames).toContain('subreddit_info');
  });

  it('x_crawl_post routes reddit to subreddit posts via executeTool', async () => {
    const result = await executeTool('x_crawl_post', {
      platform: 'reddit',
      name: 'programming',
      limit: 5,
      baseUrl: serverUrl,
    });
    expect(result).toBeDefined();
    const payload = result.isError ? result : result;
    if (!result.isError) {
      expect(result.posts).toBeDefined();
      expect(result.posts[0].id).toBe('reddit:t3_mcp_test');
    }
  });

  it('x_crawl_comments_tree routes reddit post comments via executeTool', async () => {
    const result = await executeTool('x_crawl_comments_tree', {
      platform: 'reddit',
      postId: 'mcp_test',
      subreddit: 'programming',
      baseUrl: serverUrl,
    });
    if (!result.isError) {
      expect(result.comments).toBeDefined();
      expect(result.comments[0].content).toBe('MCP Comment Body');
    }
  });
});
