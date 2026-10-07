/**
 * Root — Registers all Medirus video compositions with Remotion.
 * @author nich (@nichxbt)
 */

import React from 'react';
import { Composition } from 'remotion';
import { FPS, WIDTH, HEIGHT, V_WIDTH, V_HEIGHT, SQ_WIDTH, SQ_HEIGHT } from './utils/theme.js';
import { TweetVideo } from './compositions/TweetVideo.jsx';
import { ThreadVideo } from './compositions/ThreadVideo.jsx';
import { AnalyticsDashboard } from './compositions/AnalyticsDashboard.jsx';
import { PromoVideo } from './compositions/PromoVideo.jsx';

export const RemotionRoot = () => {
  return (
    <>
      {/* ─── Tweet Card Videos ─── */}
      <Composition
        id="TweetVideo"
        component={TweetVideo}
        durationInFrames={150}
        fps={FPS}
        width={V_WIDTH}
        height={V_HEIGHT}
        defaultProps={{
          author: 'nich',
          handle: '@nichxbt',
          text: 'Medirus: 75+ free MCP tools for Twitter automation.\n\nNo API fees. Open source. Works with Claude, Cursor, GPT.\n\nnpx medirus-mcp',
          likes: 2847,
          retweets: 412,
          replies: 163,
          verified: true,
        }}
      />

      <Composition
        id="TweetVideo-Landscape"
        component={TweetVideo}
        durationInFrames={150}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{
          author: 'nich',
          handle: '@nichxbt',
          text: 'Medirus: 75+ free MCP tools for Twitter automation.\n\nNo API fees. Open source. Works with Claude, Cursor, GPT.\n\nnpx medirus-mcp',
          likes: 2847,
          retweets: 412,
          replies: 163,
          verified: true,
        }}
      />

      <Composition
        id="TweetVideo-Square"
        component={TweetVideo}
        durationInFrames={150}
        fps={FPS}
        width={SQ_WIDTH}
        height={SQ_HEIGHT}
        defaultProps={{
          author: 'nich',
          handle: '@nichxbt',
          text: 'Medirus: 75+ free MCP tools for Twitter automation.\n\nNo API fees. Open source. Works with Claude, Cursor, GPT.\n\nnpx medirus-mcp',
          likes: 2847,
          retweets: 412,
          replies: 163,
          verified: true,
        }}
      />

      {/* ─── Thread Unroll Videos ─── */}
      <Composition
        id="ThreadVideo"
        component={ThreadVideo}
        durationInFrames={300}
        fps={FPS}
        width={V_WIDTH}
        height={V_HEIGHT}
        defaultProps={{
          author: 'nich',
          handle: '@nichxbt',
          verified: true,
          tweets: [
            'I built a free MCP server with 75+ tools for Twitter automation.\n\nHere\'s what it can do 🧵',
            '1/ Scrape anything — profiles, followers, tweets, threads, videos.\n\nNo API key needed. Just your browser cookie.',
            '2/ AI writing assistant — analyze anyone\'s voice, then generate tweets that match their style.\n\nPowered by free LLMs via OpenRouter.',
            '3/ Real-time analytics — best time to post, engagement rates, follower growth, sentiment analysis.',
            '4/ Works with Claude, Cursor, Windsurf, VS Code, GPT.\n\nJust run: npx medirus-mcp\n\ngithub.com/nirholas/XActions',
          ],
        }}
      />

      <Composition
        id="ThreadVideo-Landscape"
        component={ThreadVideo}
        durationInFrames={300}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{
          author: 'nich',
          handle: '@nichxbt',
          verified: true,
          tweets: [
            'I built a free MCP server with 75+ tools for Twitter automation.\n\nHere\'s what it can do 🧵',
            '1/ Scrape anything — profiles, followers, tweets, threads, videos.\n\nNo API key needed.',
            '2/ AI writing assistant — analyze voice → generate matching tweets.',
            '3/ Real-time analytics — best posting times, engagement, sentiment.',
            '4/ Works with Claude, Cursor, GPT.\n\nnpx medirus-mcp\ngithub.com/nirholas/XActions',
          ],
        }}
      />

      {/* ─── Analytics Dashboard ─── */}
      <Composition
        id="AnalyticsDashboard"
        component={AnalyticsDashboard}
        durationInFrames={240}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{
          handle: '@nichxbt',
          followers: 12483,
          following: 847,
          tweets: 3291,
          engagementRate: 4.7,
          followerGrowth: 12.3,
          bestHour: '9 AM',
          bestDay: 'Tuesday',
          hourlyData: [
            { hour: '6AM', value: 20 }, { hour: '8AM', value: 45 },
            { hour: '9AM', value: 92 }, { hour: '10AM', value: 78 },
            { hour: '12PM', value: 65 }, { hour: '2PM', value: 50 },
            { hour: '5PM', value: 70 }, { hour: '8PM', value: 85 },
            { hour: '10PM', value: 55 },
          ],
        }}
      />

      {/* ─── Promo / Marketing Video ─── */}
      <Composition
        id="PromoVideo"
        component={PromoVideo}
        durationInFrames={450}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      <Composition
        id="PromoVideo-Vertical"
        component={PromoVideo}
        durationInFrames={450}
        fps={FPS}
        width={V_WIDTH}
        height={V_HEIGHT}
      />
    </>
  );
};
