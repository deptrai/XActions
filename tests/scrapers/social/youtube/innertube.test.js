// by nichxbt — Story 33.4: InnerTube Client tests (FR-115)
import { describe, it, expect, vi } from 'vitest';
import { InnerTubeClient, INNERTUBE_API_KEY, INNERTUBE_CLIENT_VERSION } from '../../../../src/scrapers/social/youtube/innertube.js';

const makeFetchMock = (response) => vi.fn(async (opts) => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(response),
  data: response,
}));

describe('Story 33.4 — InnerTubeClient (FR-115)', () => {
  it('initializes with hardcoded InnerTube key, no API key required', () => {
    const client = new InnerTubeClient();
    expect(client.apiKey).toBe(INNERTUBE_API_KEY); // InnerTube has hardcoded key
    expect(client.clientName).toBe('WEB');
    expect(client.baseUrl).toBe('https://www.youtube.com/youtubei/v1');
  });

  it('buildContext returns vi-VN locale defaults', () => {
    const client = new InnerTubeClient();
    const ctx = client.buildContext();
    expect(ctx.client.hl).toBe('vi');
    expect(ctx.client.gl).toBe('VN');
    expect(ctx.client.clientName).toBe('WEB');
    expect(ctx.client.clientVersion).toBe(INNERTUBE_CLIENT_VERSION);
    expect(ctx.request.useSsl).toBe(true);
  });

  it('buildContext accepts overrides', () => {
    const client = new InnerTubeClient();
    const ctx = client.buildContext({ client: { hl: 'en' } });
    expect(ctx.client.hl).toBe('en');
    expect(ctx.client.gl).toBe('VN'); // preserved
  });

  it('getLiveChat extracts messages and continuation', async () => {
    const mockResponse = {
      continuationContents: {
        liveChatContinuation: {
          actions: [
            {
              addChatItemAction: {
                item: {
                  liveChatTextMessageRenderer: {
                    id: 'msg1',
                    authorName: { simpleText: 'viewer1' },
                    message: { simpleText: 'hello stream' },
                    timestampUsec: '1690000000000000',
                    authorExternalChannelId: 'chan1',
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatPaidMessageRenderer: {
                    id: 'msg2',
                    authorName: { simpleText: 'superfan' },
                    message: { simpleText: 'paid message' },
                    timestampUsec: '1690000001000000',
                    authorExternalChannelId: 'chan2',
                  },
                },
              },
            },
          ],
          continuations: [{
            continuationData: { continuation: 'next_token', timeoutMs: 3000 },
          }],
        },
      },
    };

    const client = new InnerTubeClient({ httpClient: makeFetchMock(mockResponse) });
    const result = await client.getLiveChat('vid123', { continuation: 'initial_continuation' });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].author).toBe('viewer1');
    expect(result.messages[0].isPaid).toBe(false);
    expect(result.messages[1].isPaid).toBe(true);
    expect(result.continuation).toBe('next_token');
    expect(result.timeoutMs).toBe(3000);
  });

  it('getShortsAnalytics parses engagement metrics', async () => {
    const mockResponse = {
      contents: {
        twoColumnWatchNextResults: {
          results: {
            results: {
              contents: [
                {
                  videoPrimaryInfoRenderer: {
                    viewCount: { videoViewCountRenderer: { viewCount: { simpleText: '1.2M' } } },
                    videoActions: {
                      menuRenderer: {
                        topLevelButtons: [{
                          segmentedLikeDislikeButtonViewModel: { likeCount: '45K' },
                        }],
                      },
                    },
                  },
                },
                {
                  videoSecondaryInfoRenderer: {
                    commentsCount: { simpleText: '2.3K' },
                  },
                },
              ],
            },
          },
        },
      },
    };

    const client = new InnerTubeClient({ httpClient: makeFetchMock(mockResponse) });
    const result = await client.getShortsAnalytics('short123');

    expect(result.views).toBe(1200000);
    expect(result.likes).toBe(45000);
    expect(result.comments).toBe(2300);
    expect(result.likeRate).toBeCloseTo(3.75, 2);
    expect(result.commentRate).toBeCloseTo(0.19, 2);
  });

  it('getSubscriberCount parses channel subscriber count', async () => {
    const mockResponse = {
      header: {
        c4TabbedHeaderRenderer: {
          subscriberCountText: { simpleText: '1.5M' },
        },
      },
    };

    const client = new InnerTubeClient({ httpClient: makeFetchMock(mockResponse) });
    const result = await client.getSubscriberCount('UC123');

    expect(result.subscribers).toBe(1500000);
    expect(result.channelId).toBe('UC123');
    expect(result.capturedAt).toBeGreaterThan(0);
  });

  it('getMusicTrendingVn parses track list', async () => {
    const mockResponse = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [{
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [{
                    musicCarouselShelfRenderer: {
                      contents: [
                        {
                          musicTwoRowItemRenderer: {
                            title: { runs: [{ text: 'Track A' }] },
                            subtitle: { runs: [{ text: 'Artist X' }] },
                            subtitleBadge: { musicRendererBadge: { label: '500K' } },
                            thumbnailRenderer: {
                              musicThumbnailRenderer: {
                                thumbnail: { thumbnails: [{ url: 'https://img1.jpg' }] },
                              },
                            },
                          },
                        },
                      ],
                    },
                  }],
                },
              },
            },
          }],
        },
      },
    };

    const client = new InnerTubeClient({ httpClient: makeFetchMock(mockResponse) });
    const result = await client.getMusicTrendingVn({ limit: 5 });

    expect(result.region).toBe('VN');
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe('Track A');
    expect(result.tracks[0].artist).toBe('Artist X');
    expect(result.tracks[0].views).toBe(500000);
  });

  it('throws RateLimitError on 429', async () => {
    const client = new InnerTubeClient({
      httpClient: vi.fn(async () => {
        const err = new Error('rate limit');
        err.status = 429;
        throw err;
      }),
    });

    await expect(client.getShortsAnalytics('vid')).rejects.toThrow(/rate limit|503|Upstream/i);
  });
});
