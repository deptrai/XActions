// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions AI Tweet Generator
 * 
 * Uses OpenRouter to generate tweets in a user's voice.
 * Supports single tweets, threads, rewrites, weekly calendars, and replies.
 * 
 * The moat: scrape tweets → analyze voice → generate in their style.
 * Nobody else has this integrated with Twitter scraping.
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { buildVoicePrompt } from './voiceAnalyzer.js';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_MODEL = 'google/gemini-flash-2.0';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GROK_URL = 'https://api.x.ai/v1/chat/completions';

// Provider-specific default models
const PROVIDER_DEFAULTS = {
  openrouter: 'google/gemini-flash-2.0',
  openai: 'gpt-4o-mini',
  grok: 'grok-3-mini',
};

// Tone presets for the AI Tweet Writer (Epic 4)
const TONE_PRESETS = {
  funny: 'Be genuinely funny — use wit, playful observations, and relatable humor. Avoid forced jokes or cringe.',
  professional: 'Be polished and authoritative — clear, credible, expert tone. No slang, no hype.',
  controversial: 'Be bold and contrarian — take a strong stance that sparks debate. Back it with a real argument.',
  casual: 'Be conversational and relaxed — like texting a friend. Lowercase energy, natural phrasing.',
  inspirational: 'Be uplifting and motivational — share a lesson or encouragement that resonates.',
  educational: 'Be informative and valuable — teach something concrete in a digestible way.',
};

// ============================================================================
// LLM Provider Client (OpenRouter / OpenAI / Grok)
// ============================================================================

/**
 * Resolve which provider to use.
 * Priority: options.provider > options.apiKey identity > env vars.
 * If OPENAI_API_KEY is set (and no explicit provider), use OpenAI.
 * If XAI_API_KEY / GROK_API_KEY is set, use Grok.
 * Otherwise fall back to OpenRouter (default).
 */
function resolveProvider(options = {}) {
  if (options.provider) return options.provider;
  if (options.openaiApiKey || process.env.OPENAI_API_KEY) return 'openai';
  if (options.grokApiKey || process.env.XAI_API_KEY || process.env.GROK_API_KEY) return 'grok';
  return 'openrouter';
}

/**
 * Call an LLM via the configured provider (OpenRouter, OpenAI, or Grok/xAI).
 * All three expose an OpenAI-compatible chat completions endpoint.
 */
async function callLLM(messages, options = {}) {
  const provider = resolveProvider(options);
  const temperature = options.temperature ?? 0.8;
  const maxTokens = options.maxTokens || 2000;

  let url, apiKey, headers, model;

  if (provider === 'openai') {
    apiKey = options.openaiApiKey || options.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key required. Set OPENAI_API_KEY env var or pass apiKey option.');
    url = OPENAI_URL;
    model = options.model || PROVIDER_DEFAULTS.openai;
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  } else if (provider === 'grok') {
    apiKey = options.grokApiKey || options.apiKey || process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    if (!apiKey) throw new Error('Grok/xAI API key required. Set XAI_API_KEY (or GROK_API_KEY) env var or pass apiKey option.');
    url = GROK_URL;
    model = options.model || PROVIDER_DEFAULTS.grok;
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  } else {
    // OpenRouter (default) — supports OpenAI, Grok, Gemini, etc. via one key
    apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('LLM API key required. Set OPENROUTER_API_KEY (or OPENAI_API_KEY / XAI_API_KEY) env var, or pass apiKey option.');
    url = OPENROUTER_URL;
    model = options.model || PROVIDER_DEFAULTS.openrouter;
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://xactions.app',
      'X-Title': 'XActions AI Tweet Writer',
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${provider} API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  return {
    content,
    provider,
    model: data.model || model,
    usage: data.usage || {},
  };
}

/**
 * Call OpenRouter API (backward-compatible wrapper around callLLM).
 * @deprecated Prefer callLLM — supports multiple providers.
 */
async function callOpenRouter(messages, options = {}) {
  return callLLM(messages, { ...options, provider: 'openrouter' });
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
function parseJSON(content) {
  // Try direct parse first
  try {
    return JSON.parse(content);
  } catch { /* continue */ }

  // Try extracting from markdown code block
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch { /* continue */ }
  }

  // Try extracting any JSON object/array
  const objMatch = content.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[1]);
    } catch { /* continue */ }
  }

  throw new Error('Failed to parse JSON from LLM response');
}

// ============================================================================
// Tweet Generation Functions
// ============================================================================

/**
 * Generate tweets matching a user's voice
 * 
 * @param {object} voiceProfile - VoiceProfile from analyzeVoice()
 * @param {object} options
 * @param {string} options.topic - Topic or prompt for the tweet
 * @param {string} [options.style] - Optional style override: 'hot-take', 'educational', 'personal', 'promotional'
 * @param {number} [options.count=3] - Number of variations to generate (1-5)
 * @param {string} [options.model] - OpenRouter model override
 * @param {string} [options.apiKey] - OpenRouter API key override
 * @returns {Promise<{ tweets: Array<{ text: string, estimatedEngagement: string, reasoning: string }>, model: string }>}
 */
export async function generateTweet(voiceProfile, options = {}) {
  const { topic, style, tone, count = 3, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  if (!topic) throw new Error('topic is required');
  if (!voiceProfile) throw new Error('voiceProfile is required');

  const systemPrompt = buildVoicePrompt(voiceProfile);

  // Build tone/style directive. Tone (Epic 4) takes precedence when provided.
  const directives = [];
  if (tone && TONE_PRESETS[tone]) directives.push(`Tone: ${TONE_PRESETS[tone]}`);
  if (style) directives.push(`Style: ${style}`);
  const directiveBlock = directives.length ? `\n${directives.join('\n')}` : '';

  const userPrompt = `Generate ${Math.min(count, 5)} tweet variations about: "${topic}"${directiveBlock}

Each tweet must:
- Be under 280 characters
- Match @${voiceProfile.username}'s voice exactly
- Be authentic and engaging

Respond with ONLY a JSON array:
[
  {
    "text": "the tweet text",
    "estimatedEngagement": "high" | "medium" | "low",
    "reasoning": "why this should perform well"
  }
]`;

  const result = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.85 });

  const tweets = parseJSON(result.content);

  return {
    tweets: Array.isArray(tweets) ? tweets.slice(0, 5) : [tweets],
    tone: tone || null,
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

/**
 * Generate a Twitter thread
 * 
 * @param {object} voiceProfile - VoiceProfile from analyzeVoice()
 * @param {object} options
 * @param {string} options.topic - Topic for the thread
 * @param {number} [options.length=5] - Number of tweets in thread (3-10)
 * @param {boolean} [options.hooks=true] - Whether to include a hook opener and CTA closer
 * @param {string} [options.model] - OpenRouter model override
 * @param {string} [options.apiKey] - OpenRouter API key override
 * @returns {Promise<{ thread: Array<{ position: number, text: string, purpose: string }>, model: string }>}
 */
export async function generateThread(voiceProfile, options = {}) {
  const { topic, length = 5, hooks = true, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  if (!topic) throw new Error('topic is required');

  const systemPrompt = buildVoicePrompt(voiceProfile);
  const threadLength = Math.min(Math.max(length, 3), 10);

  const userPrompt = `Write a ${threadLength}-tweet thread about: "${topic}"

Structure:
${hooks ? '1. Tweet 1: Attention-grabbing hook (create curiosity or state a bold claim)' : '1. Tweet 1: Introduction'}
2. Tweets 2-${threadLength - 1}: Main points (each tweet should stand alone but flow together)
${hooks ? `3. Tweet ${threadLength}: Call to action (ask for follow, retweet, or reply)` : `3. Tweet ${threadLength}: Conclusion`}

Rules:
- Each tweet MUST be under 280 characters
- Number each tweet (1/${threadLength}, 2/${threadLength}, etc.)
- Match @${voiceProfile.username}'s voice
- Make it engaging and valuable

Respond with ONLY a JSON array:
[
  {
    "position": 1,
    "text": "1/${threadLength} the tweet text",
    "purpose": "hook" | "point" | "example" | "cta"
  }
]`;

  const result = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.8, maxTokens: 3000 });

  const thread = parseJSON(result.content);

  return {
    thread: Array.isArray(thread) ? thread : [thread],
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

/**
 * Generate a Twitter thread from long-form text (auto-split).
 * Epic 4: "Thread generator from long text (auto-split into thread)".
 *
 * The LLM condenses the source text into a coherent thread, splitting at natural
 * boundaries so each tweet stays under 280 chars while preserving the narrative.
 *
 * @param {object} voiceProfile - VoiceProfile from analyzeVoice() (may be a generic profile)
 * @param {object} options
 * @param {string} options.text - The long-form text to convert into a thread
 * @param {number} [options.maxLength=10] - Maximum number of tweets in the thread (3-15)
 * @param {boolean} [options.hooks=true] - Whether to include a hook opener and CTA closer
 * @param {string} [options.tone] - Optional tone override (funny, professional, controversial, ...)
 * @param {string} [options.model] - Model override
 * @param {string} [options.apiKey] - API key override
 * @param {string} [options.provider] - Provider override: 'openrouter' | 'openai' | 'grok'
 * @returns {Promise<{ thread: Array<{ position: number, text: string, purpose: string }>, sourceLength: number, model: string }>}
 */
export async function generateThreadFromText(voiceProfile, options = {}) {
  const { text, maxLength = 10, hooks = true, tone, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  if (!text) throw new Error('text is required — the long-form text to split into a thread');
  if (!voiceProfile) throw new Error('voiceProfile is required');

  const systemPrompt = buildVoicePrompt(voiceProfile);
  const maxLen = Math.min(Math.max(maxLength, 3), 15);

  const toneDirective = tone && TONE_PRESETS[tone] ? `\nTone: ${TONE_PRESETS[tone]}` : '';

  const userPrompt = `Convert the following long-form text into a coherent Twitter thread of at most ${maxLen} tweets.

Source text:
"""
${text}
"""

Rules:
- Each tweet MUST be under 280 characters (this is a hard limit — split mid-sentence if needed, but keep each tweet readable).
- Preserve all key points and the narrative order from the source.
- Number each tweet (1/N, 2/N, etc.).
- Match @${voiceProfile.username}'s voice.${toneDirective}
${hooks ? '- Tweet 1: attention-grabbing hook. Last tweet: call to action (follow, retweet, or reply).' : '- First tweet introduces, last tweet concludes.'}
- Do NOT invent new information not present in the source.

Respond with ONLY a JSON array:
[
  {
    "position": 1,
    "text": "1/N the tweet text",
    "purpose": "hook" | "point" | "example" | "quote" | "cta"
  }
]`;

  const result = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.6, maxTokens: 4000 });

  const thread = parseJSON(result.content);

  return {
    thread: Array.isArray(thread) ? thread.slice(0, maxLen) : [thread],
    sourceLength: text.length,
    tone: tone || null,
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

/**
 * Rewrite/improve an existing tweet
 * 
 * @param {object} voiceProfile - VoiceProfile from analyzeVoice()
 * @param {string} originalText - The original tweet to improve
 * @param {object} [options]
 * @param {string} [options.goal='more_engaging'] - 'more_engaging' | 'shorter' | 'add_hook' | 'more_casual' | 'more_formal' | 'add_cta'
 * @param {number} [options.count=3] - Number of variations
 * @param {string} [options.model] - OpenRouter model override
 * @param {string} [options.apiKey] - OpenRouter API key override
 * @returns {Promise<{ original: string, rewrites: Array<{ text: string, improvement: string }>, model: string }>}
 */
export async function rewriteTweet(voiceProfile, originalText, options = {}) {
  const { goal = 'more_engaging', count = 3, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  if (!originalText) throw new Error('originalText is required');

  const systemPrompt = buildVoicePrompt(voiceProfile);

  const goalInstructions = {
    'more_engaging': 'Make it more attention-grabbing and likely to get engagement (likes, replies, retweets)',
    'shorter': 'Make it more concise and punchy while keeping the core message',
    'add_hook': 'Add a strong opening hook that creates curiosity or controversy',
    'more_casual': 'Make it sound more casual, conversational, and relatable',
    'more_formal': 'Make it sound more professional and authoritative',
    'add_cta': 'Add a clear call-to-action that drives engagement',
  };

  const userPrompt = `Rewrite this tweet ${count} different ways:

Original: "${originalText}"

Goal: ${goalInstructions[goal] || goalInstructions['more_engaging']}

Rules:
- Keep under 280 characters
- Maintain @${voiceProfile.username}'s voice
- Each variation should be meaningfully different

Respond with ONLY a JSON array:
[
  {
    "text": "the rewritten tweet",
    "improvement": "what was changed and why"
  }
]`;

  const result = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.85 });

  const rewrites = parseJSON(result.content);

  return {
    original: originalText,
    goal,
    rewrites: Array.isArray(rewrites) ? rewrites.slice(0, 5) : [rewrites],
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

/**
 * Generate a week's content calendar
 * 
 * @param {object} voiceProfile - VoiceProfile from analyzeVoice()
 * @param {object} [options]
 * @param {string[]} [options.topics] - Topics to cover (auto-generated from pillars if not provided)
 * @param {number} [options.postsPerDay=2] - Posts per day (1-5)
 * @param {number} [options.days=7] - Number of days (1-14)
 * @param {string} [options.model] - OpenRouter model override
 * @param {string} [options.apiKey] - OpenRouter API key override
 * @returns {Promise<{ calendar: Array<{ day: string, slot: string, topic: string, text: string, type: string }>, model: string }>}
 */
export async function generateWeek(voiceProfile, options = {}) {
  const { topics, postsPerDay = 2, days = 7, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  const resolvedTopics = topics && topics.length > 0
    ? topics
    : voiceProfile.contentPillars.map(p => p.topic);

  const dayCount = Math.min(Math.max(days, 1), 14);
  const ppd = Math.min(Math.max(postsPerDay, 1), 5);
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const slots = ['morning', 'afternoon', 'evening'];

  const systemPrompt = buildVoicePrompt(voiceProfile);

  const userPrompt = `Create a ${dayCount}-day content calendar with ${ppd} tweets per day.

Topics to cover: ${resolvedTopics.join(', ')}

For each tweet provide:
- The day (${dayNames.slice(0, dayCount).join(', ')})
- Time slot (${slots.slice(0, ppd).join(', ')})
- The actual tweet text (under 280 chars)
- Type: "single", "thread-hook", "question", "hot-take", "value-bomb", "personal"

Mix up the types for variety. Create a good rhythm.
Match @${voiceProfile.username}'s voice.

Respond with ONLY a JSON array:
[
  {
    "day": "Monday",
    "slot": "morning",
    "topic": "the topic",
    "text": "the tweet text",
    "type": "single"
  }
]`;

  const result = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.85, maxTokens: 4000 });

  const calendar = parseJSON(result.content);

  return {
    calendar: Array.isArray(calendar) ? calendar : [calendar],
    days: dayCount,
    postsPerDay: ppd,
    topics: resolvedTopics,
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

/**
 * Generate a reply to someone else's tweet
 * 
 * @param {object} voiceProfile - VoiceProfile from analyzeVoice()
 * @param {string} originalTweet - The tweet to reply to
 * @param {object} [options]
 * @param {string} [options.tone] - 'agree', 'disagree', 'add-on', 'question', 'funny', 'supportive'
 * @param {number} [options.count=3] - Number of reply variations
 * @param {string} [options.model] - OpenRouter model override
 * @param {string} [options.apiKey] - OpenRouter API key override
 * @returns {Promise<{ originalTweet: string, replies: Array<{ text: string, tone: string, reasoning: string }>, model: string }>}
 */
export async function generateReply(voiceProfile, originalTweet, options = {}) {
  const { tone, count = 3, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  if (!originalTweet) throw new Error('originalTweet is required');

  const systemPrompt = buildVoicePrompt(voiceProfile);

  const userPrompt = `Generate ${Math.min(count, 5)} reply variations to this tweet:

"${originalTweet}"

${tone ? `Desired tone: ${tone}` : 'Choose the most natural tone for this reply.'}

Rules:
- Keep under 280 characters
- Sound natural, not generic
- Match @${voiceProfile.username}'s voice
- Be thoughtful, not spammy
- Add value to the conversation

Respond with ONLY a JSON array:
[
  {
    "text": "the reply text",
    "tone": "agree" | "disagree" | "add-on" | "question" | "funny" | "supportive",
    "reasoning": "why this reply works"
  }
]`;

  const result = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.85 });

  const replies = parseJSON(result.content);

  return {
    originalTweet,
    replies: Array.isArray(replies) ? replies.slice(0, 5) : [replies],
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

// ============================================================================
// Convenience: Competitor Analysis
// ============================================================================

/**
 * Analyze competitor's top-performing patterns and generate tweets for YOUR voice
 * The killer feature: scrape competitor → analyze what works → generate in YOUR voice
 * 
 * @param {object} myVoiceProfile - Your VoiceProfile
 * @param {object} competitorVoiceProfile - Competitor's VoiceProfile
 * @param {object} [options]
 * @param {number} [options.count=5] - Number of tweets to generate
 * @param {string} [options.model] - OpenRouter model override
 * @param {string} [options.apiKey] - OpenRouter API key override
 * @returns {Promise<{ insights: string, tweets: Array<{ text: string, inspiredBy: string }>, model: string }>}
 */
export async function analyzeCompetitorAndGenerate(myVoiceProfile, competitorVoiceProfile, options = {}) {
  const { count = 5, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  const myPrompt = buildVoicePrompt(myVoiceProfile);

  const competitorInsights = [];
  competitorInsights.push(`## Competitor Analysis: @${competitorVoiceProfile.username}`);
  
  if (competitorVoiceProfile.bestPerforming.commonTraits.length > 0) {
    competitorInsights.push(`\nWhat works for them:`);
    for (const trait of competitorVoiceProfile.bestPerforming.commonTraits) {
      competitorInsights.push(`- ${trait}`);
    }
  }

  if (competitorVoiceProfile.bestPerforming.examples.length > 0) {
    competitorInsights.push(`\nTheir top tweets:`);
    for (const ex of competitorVoiceProfile.bestPerforming.examples.slice(0, 3)) {
      competitorInsights.push(`"${ex.text}" (❤️${ex.likes})`);
    }
  }

  if (competitorVoiceProfile.contentPillars.length > 0) {
    competitorInsights.push(`\nTheir topics: ${competitorVoiceProfile.contentPillars.map(p => p.topic).join(', ')}`);
  }

  const userPrompt = `I want to learn from what works for @${competitorVoiceProfile.username} and create ${count} tweets in MY voice (@${myVoiceProfile.username}).

${competitorInsights.join('\n')}

Generate ${count} tweets that:
1. Are inspired by the competitor's successful patterns/topics
2. But written in @${myVoiceProfile.username}'s voice and style
3. Add my unique perspective — don't copy, be original
4. Under 280 characters each

Respond with ONLY a JSON object:
{
  "insights": "brief analysis of what works for the competitor",
  "tweets": [
    {
      "text": "the tweet",
      "inspiredBy": "what pattern/topic from the competitor inspired this"
    }
  ]
}`;

  const result = await callLLM([
    { role: 'system', content: myPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.85, maxTokens: 3000 });

  const parsed = parseJSON(result.content);

  return {
    insights: parsed.insights || '',
    tweets: parsed.tweets || [],
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

// ============================================================================
// Bio Generator (Epic 4)
// ============================================================================

/**
 * Generate Twitter bio options for an account.
 * Epic 4: "Bio generator".
 *
 * Uses the voice profile (if available) to match the user's style, or generates
 * from a topic/keywords description when no profile is available.
 *
 * @param {object|null} voiceProfile - VoiceProfile from analyzeVoice() (optional)
 * @param {object} options
 * @param {string} [options.topic] - Topic/niche description (required if no voiceProfile)
 * @param {string[]} [options.keywords] - Keywords to include
 * @param {string} [options.tone] - Tone override (funny, professional, controversial, ...)
 * @param {number} [options.count=5] - Number of bio variations (1-10)
 * @param {number} [options.maxLength=160] - Max characters per bio (Twitter limit 160)
 * @param {string} [options.model] - Model override
 * @param {string} [options.apiKey] - API key override
 * @param {string} [options.provider] - Provider override: 'openrouter' | 'openai' | 'grok'
 * @returns {Promise<{ bios: Array<{ text: string, style: string, characterCount: number }>, model: string }>}
 */
export async function generateBio(voiceProfile, options = {}) {
  const { topic, keywords, tone, count = 5, maxLength = 160, model, apiKey, provider, openaiApiKey, grokApiKey } = options;

  if (!topic && !voiceProfile) {
    throw new Error('Either topic or voiceProfile is required for bio generation');
  }

  const systemPrompt = voiceProfile
    ? buildVoicePrompt(voiceProfile)
    : 'You are an expert Twitter/X bio writer who crafts memorable, scroll-stopping bios.';

  const toneDirective = tone && TONE_PRESETS[tone] ? `\nTone: ${TONE_PRESETS[tone]}` : '';
  const keywordLine = keywords && keywords.length ? `\nInclude (or allude to): ${keywords.join(', ')}` : '';
  const subjectLine = topic ? `\nAbout: ${topic}` : `\nAbout: @${voiceProfile.username}'s niche and content pillars`;

  const userPrompt = `Generate ${Math.min(count, 10)} Twitter/X bio options.${subjectLine}${keywordLine}${toneDirective}

Rules:
- Each bio MUST be under ${maxLength} characters (Twitter bio limit is 160).
- Make each bio distinct in style (e.g. punchy one-liner, list of roles, witty, aspirational, credential-led).
- No emojis unless the tone calls for it.
- No hashtags unless explicitly requested.

Respond with ONLY a JSON array:
[
  {
    "text": "the bio text",
    "style": "one-liner" | "role-list" | "witty" | "aspirational" | "credential-led" | "question",
    "characterCount": 42
  }
]`;

  const result = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { model, apiKey, provider, openaiApiKey, grokApiKey, temperature: 0.9, maxTokens: 1500 });

  const bios = parseJSON(result.content);

  return {
    bios: Array.isArray(bios) ? bios.slice(0, 10) : [bios],
    tone: tone || null,
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

export default {
  generateTweet,
  generateThread,
  generateThreadFromText,
  rewriteTweet,
  generateWeek,
  generateReply,
  generateBio,
  analyzeCompetitorAndGenerate,
};
