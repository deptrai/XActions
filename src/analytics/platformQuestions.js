// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Platform-Specific Jev Question Sets for Viral DNA Mining
 * 
 * Each platform has a tailored set of 10-14 questions optimized for
 * extracting viral DNA attributes from that platform's content type.
 * 
 * @module src/analytics/platformQuestions
 */

/**
 * @typedef {Object} JevQuestion
 * @property {string} type - 'choice' | 'noul' | 'score'
 * @property {string} instructions - Question prompt for Jev
 * @property {string[]} [options] - For 'choice' type
 * @property {number} [min] - For 'score' type
 * @property {number} [max] - For 'score' type
 */

/**
 * Common questions shared across all platforms
 */
const COMMON_QUESTIONS = {
  emotionalTrigger: {
    type: 'choice',
    instructions: 'What is the primary emotional trigger in this content?',
    options: ['fear', 'greed', 'anger', 'joy', 'surprise', 'trust', 'anticipation', 'none'],
  },
  curiosityGap: {
    type: 'noul',
    instructions: 'Does this content create a curiosity gap (information gap that makes reader want to learn more)?',
  },
  hasNumbers: {
    type: 'noul',
    instructions: 'Does this content include specific numbers, statistics, or data points?',
  },
  urgencyLevel: {
    type: 'score',
    instructions: 'Rate the urgency level of this content (0=none, 1=low, 2=medium, 3=high)',
    min: 0,
    max: 3,
  },
  specificityLevel: {
    type: 'score',
    instructions: 'Rate how specific vs generic this content is (0=generic, 1=somewhat, 2=specific, 3=highly specific)',
    min: 0,
    max: 3,
  },
  controversiality: {
    type: 'score',
    instructions: 'Rate how controversial or polarizing this content is (0=neutral, 1=mild, 2=controversial, 3=highly polarizing)',
    min: 0,
    max: 3,
  },
};

/**
 * Platform-specific question sets
 * Each platform extends COMMON_QUESTIONS with platform-specific questions
 */
export const PLATFORM_QUESTIONS = {
  // ==========================================================================
  // SOCIAL PLATFORMS
  // ==========================================================================
  
  twitter: {
    ...COMMON_QUESTIONS,
    hookType: {
      type: 'choice',
      instructions: 'What is the primary hook type of this tweet?',
      options: ['assertion', 'question', 'contrarian', 'listicle', 'story', 'howto', 'observation', 'other'],
    },
    evidenceType: {
      type: 'choice',
      instructions: 'What type of evidence does this tweet use?',
      options: ['data', 'anecdote', 'authority', 'personalExperience', 'none'],
    },
    formatType: {
      type: 'choice',
      instructions: 'What is the format of this tweet?',
      options: ['thread', 'single', 'reply', 'quote', 'poll', 'media'],
    },
    hasCallToAction: {
      type: 'noul',
      instructions: 'Does this tweet have a clear call-to-action (follow, retweet, click link, etc.)?',
    },
  },

  threads: {
    ...COMMON_QUESTIONS,
    hookType: {
      type: 'choice',
      instructions: 'What is the primary hook type of this Threads post?',
      options: ['assertion', 'question', 'contrarian', 'listicle', 'story', 'howto', 'meta', 'other'],
    },
    evidenceType: {
      type: 'choice',
      instructions: 'What type of evidence does this post use?',
      options: ['data', 'anecdote', 'authority', 'personalExperience', 'none'],
    },
    threadDepth: {
      type: 'score',
      instructions: 'If this is a thread, how deep/complex is it? (0=single post, 1=shallow, 2=medium, 3=deep)',
      min: 0,
      max: 3,
    },
    metaReference: {
      type: 'noul',
      instructions: 'Does this post reference Meta, Instagram, or Facebook ecosystem?',
    },
    hasCallToAction: {
      type: 'noul',
      instructions: 'Does this post have a clear call-to-action?',
    },
  },

  facebook: {
    ...COMMON_QUESTIONS,
    emotionalTrigger: {
      type: 'choice',
      instructions: 'What is the primary emotional trigger in this Facebook post?',
      options: ['family', 'community', 'outrage', 'joy', 'nostalgia', 'fear', 'inspiration', 'none'],
    },
    shareability: {
      type: 'score',
      instructions: 'How likely is this post to be shared? (0=not shareable, 1=somewhat, 2=likely, 3=highly viral)',
      min: 0,
      max: 3,
    },
    groupRelevance: {
      type: 'score',
      instructions: 'How relevant is this to Facebook group/community dynamics? (0=personal, 1=somewhat, 2=community-focused, 3=highly communal)',
      min: 0,
      max: 3,
    },
    nostalgiaFactor: {
      type: 'noul',
      instructions: 'Does this post leverage nostalgia or throwback content?',
    },
    localRelevance: {
      type: 'score',
      instructions: 'How locally relevant is this content? (0=global, 1=regional, 2=local, 3=hyperlocal)',
      min: 0,
      max: 3,
    },
  },

  tiktok: {
    ...COMMON_QUESTIONS,
    visualHookType: {
      type: 'choice',
      instructions: 'What is the primary visual hook in this TikTok video?',
      options: ['textOverlay', 'faceReveal', 'transition', 'beforeAfter', 'reaction', 'tutorial', 'storytime', 'other'],
    },
    trendingSound: {
      type: 'noul',
      instructions: 'Does this video use a trending sound or audio?',
    },
    hashtagStrategy: {
      type: 'choice',
      instructions: 'What is the hashtag strategy?',
      options: ['trending', 'niche', 'branded', 'mixed', 'none'],
    },
    pacingSpeed: {
      type: 'choice',
      instructions: 'What is the pacing of this video?',
      options: ['fast', 'medium', 'slow', 'varied'],
    },
    callToActionType: {
      type: 'choice',
      instructions: 'What type of call-to-action is used?',
      options: ['comment', 'share', 'follow', 'link', 'duet', 'none'],
    },
    first3SecondsHook: {
      type: 'noul',
      instructions: 'Does the first 3 seconds create a strong hook?',
    },
  },

  youtube: {
    ...COMMON_QUESTIONS,
    titleHookType: {
      type: 'choice',
      instructions: 'What is the hook type of this YouTube title?',
      options: ['howto', 'listicle', 'question', 'contrarian', 'curiosity', 'authority', 'news', 'other'],
    },
    thumbnailTextMatch: {
      type: 'score',
      instructions: 'How well does the thumbnail text match the title? (0=mismatch, 1=partial, 2=good, 3=perfect)',
      min: 0,
      max: 3,
    },
    keywordDensity: {
      type: 'score',
      instructions: 'How SEO-optimized is the title/description? (0=none, 1=low, 2=medium, 3=high)',
      min: 0,
      max: 3,
    },
    lengthOptimization: {
      type: 'choice',
      instructions: 'Is the video length optimized for the content type?',
      options: ['tooShort', 'optimal', 'tooLong', 'unknown'],
    },
    ctrPotential: {
      type: 'score',
      instructions: 'Rate the click-through potential of title+thumbnail combo (0=low, 3=high)',
      min: 0,
      max: 3,
    },
  },

  reddit: {
    ...COMMON_QUESTIONS,
    authenticityLevel: {
      type: 'score',
      instructions: 'How authentic/genuine does this post feel? (0=corporate, 1=somewhat, 2=authentic, 3=highly genuine)',
      min: 0,
      max: 3,
    },
    communityFit: {
      type: 'score',
      instructions: 'How well does this fit the subreddit culture? (0=poor fit, 1=okay, 2=good, 3=perfect)',
      min: 0,
      max: 3,
    },
    nicheJargon: {
      type: 'noul',
      instructions: 'Does this post use niche-specific jargon or insider language?',
    },
    storyDepth: {
      type: 'score',
      instructions: 'How detailed is the story/explanation? (0=shallow, 1=some detail, 2=detailed, 3=comprehensive)',
      min: 0,
      max: 3,
    },
    askType: {
      type: 'choice',
      instructions: 'If this is a question post, what type?',
      options: ['advice', 'opinion', 'discussion', 'help', 'rant', 'notAQuestion'],
    },
    selfPromoLevel: {
      type: 'score',
      instructions: 'How promotional is this post? (0=none, 1=subtle, 2=obvious, 3=spammy)',
      min: 0,
      max: 3,
    },
  },

  instagram: {
    ...COMMON_QUESTIONS,
    visualAesthetic: {
      type: 'choice',
      instructions: 'What is the visual aesthetic style?',
      options: ['minimalist', 'bold', 'vintage', 'professional', 'casual', 'artistic', 'other'],
    },
    hashtagDensity: {
      type: 'score',
      instructions: 'How many hashtags are used? (0=none, 1=1-5, 2=6-15, 3=16+)',
      min: 0,
      max: 3,
    },
    influencerSignal: {
      type: 'noul',
      instructions: 'Does this post signal influencer/aspirational lifestyle content?',
    },
    lifestyleCategory: {
      type: 'choice',
      instructions: 'What lifestyle category does this fit?',
      options: ['fitness', 'travel', 'food', 'fashion', 'beauty', 'tech', 'business', 'other'],
    },
    carouselDepth: {
      type: 'score',
      instructions: 'If carousel post, how many slides? (0=single, 1=2-3, 2=4-6, 3=7+)',
      min: 0,
      max: 3,
    },
  },

  bluesky: {
    ...COMMON_QUESTIONS,
    hookType: {
      type: 'choice',
      instructions: 'What is the primary hook type of this Bluesky post?',
      options: ['assertion', 'question', 'contrarian', 'listicle', 'story', 'howto', 'meta', 'other'],
    },
    evidenceType: {
      type: 'choice',
      instructions: 'What type of evidence does this post use?',
      options: ['data', 'anecdote', 'authority', 'personalExperience', 'none'],
    },
    earlyAdopterSignal: {
      type: 'noul',
      instructions: 'Does this post signal early adopter/tech-forward thinking?',
    },
    decentralizationRef: {
      type: 'noul',
      instructions: 'Does this post reference decentralization, fediverse, or web3?',
    },
  },

  mastodon: {
    ...COMMON_QUESTIONS,
    communityFit: {
      type: 'score',
      instructions: 'How well does this fit Mastodon community culture? (0=poor, 1=okay, 2=good, 3=perfect)',
      min: 0,
      max: 3,
    },
    technicalDepth: {
      type: 'score',
      instructions: 'How technically deep is this content? (0=surface, 1=some, 2=deep, 3=expert)',
      min: 0,
      max: 3,
    },
    antiCommercial: {
      type: 'noul',
      instructions: 'Does this post have anti-commercial or anti-corporate sentiment?',
    },
    nicheJargon: {
      type: 'noul',
      instructions: 'Does this post use niche-specific jargon (foss, fediverse, etc.)?',
    },
  },

  medium: {
    ...COMMON_QUESTIONS,
    headlineHook: {
      type: 'choice',
      instructions: 'What is the headline hook type?',
      options: ['howto', 'listicle', 'story', 'contrarian', 'data', 'question', 'other'],
    },
    readability: {
      type: 'score',
      instructions: 'How readable is this article? (0=academic, 1=dense, 2=readable, 3=very readable)',
      min: 0,
      max: 3,
    },
    thoughtLeadership: {
      type: 'score',
      instructions: 'How strong is the thought leadership angle? (0=none, 1=weak, 2=moderate, 3=strong)',
      min: 0,
      max: 3,
    },
    dataSupport: {
      type: 'noul',
      instructions: 'Does this article include data, charts, or research citations?',
    },
    narrativeStructure: {
      type: 'choice',
      instructions: 'What is the narrative structure?',
      options: ['problem-solution', 'story-lesson', 'list-tips', 'analysis', 'other'],
    },
  },

  zalo: {
    ...COMMON_QUESTIONS,
    localRelevance: {
      type: 'score',
      instructions: 'How locally relevant is this to Vietnamese audience? (0=global, 1=regional, 2=Vietnam, 3=hyperlocal VN)',
      min: 0,
      max: 3,
    },
    communityTrust: {
      type: 'score',
      instructions: 'How much does this leverage community trust/relationships? (0=none, 3=high)',
      min: 0,
      max: 3,
    },
    personalConnection: {
      type: 'noul',
      instructions: 'Does this post create personal connection (family, friends, local community)?',
    },
    vietnameseContext: {
      type: 'noul',
      instructions: 'Does this content require Vietnamese cultural context to understand?',
    },
  },

  // ==========================================================================
  // RECRUITMENT PLATFORMS
  // ==========================================================================

  linkedin: {
    ...COMMON_QUESTIONS,
    hookType: {
      type: 'choice',
      instructions: 'What is the primary hook type of this LinkedIn post/job?',
      options: ['professional', 'personalStory', 'industryInsight', 'dataDriven', 'controversial', 'celebration', 'other'],
    },
    credibilityType: {
      type: 'choice',
      instructions: 'What type of credibility does this establish?',
      options: ['data', 'caseStudy', 'authority', 'personalExperience', 'certification', 'none'],
    },
    industryRelevance: {
      type: 'score',
      instructions: 'How industry-specific is this content? (0=generic, 1=somewhat, 2=industry-specific, 3=niche)',
      min: 0,
      max: 3,
    },
    careerLevel: {
      type: 'choice',
      instructions: 'What career level is this targeting?',
      options: ['entry', 'mid', 'senior', 'executive', 'all'],
    },
    buzzwordDensity: {
      type: 'score',
      instructions: 'How dense is buzzword usage? (0=none, 1=light, 2=moderate, 3=heavy)',
      min: 0,
      max: 3,
    },
    salaryTransparency: {
      type: 'noul',
      instructions: 'Does this job posting include salary information?',
    },
  },

  topcv: {
    ...COMMON_QUESTIONS,
    salaryTransparency: {
      type: 'noul',
      instructions: 'Does this job posting include salary information?',
    },
    companyReputation: {
      type: 'score',
      instructions: 'How strong is the company brand/reputation signal? (0=unknown, 1=small, 2=known, 3=top-tier)',
      min: 0,
      max: 3,
    },
    urgencyLevel: {
      type: 'score',
      instructions: 'How urgent is the hiring need? (0=open-ended, 1=normal, 2=urgent, 3=immediate)',
      min: 0,
      max: 3,
    },
    skillMatch: {
      type: 'score',
      instructions: 'How specific are the skill requirements? (0=generic, 1=some, 2=specific, 3=highly specific)',
      min: 0,
      max: 3,
    },
    locationAppeal: {
      type: 'score',
      instructions: 'How appealing is the location? (0=remote-only, 1=secondary city, 2=major city, 3=prime location)',
      min: 0,
      max: 3,
    },
  },

  vietnamworks: {
    ...COMMON_QUESTIONS,
    salaryCompetitiveness: {
      type: 'score',
      instructions: 'How competitive is the salary range? (0=below market, 1=market, 2=above, 3=top tier)',
      min: 0,
      max: 3,
    },
    companyBrand: {
      type: 'score',
      instructions: 'How strong is the company brand? (0=startup, 1=SME, 2=corporate, 3=MNC)',
      min: 0,
      max: 3,
    },
    benefitsClarity: {
      type: 'score',
      instructions: 'How clear are the benefits described? (0=none, 1=vague, 2=clear, 3=comprehensive)',
      min: 0,
      max: 3,
    },
    careerGrowth: {
      type: 'score',
      instructions: 'How clear is the career growth path? (0=none, 1=implied, 2=clear, 3=explicit)',
      min: 0,
      max: 3,
    },
    workLifeBalance: {
      type: 'noul',
      instructions: 'Does this posting emphasize work-life balance or flexible arrangements?',
    },
  },

  // ==========================================================================
  // REAL ESTATE PLATFORMS
  // ==========================================================================

  chotot: {
    ...COMMON_QUESTIONS,
    priceCompetitiveness: {
      type: 'score',
      instructions: 'How competitive is the price compared to market? (0=overpriced, 1=market, 2=good, 3=great deal)',
      min: 0,
      max: 3,
    },
    urgencyType: {
      type: 'choice',
      instructions: 'What is the urgency signal?',
      options: ['hotDeal', 'motivated', 'regular', 'negotiable', 'unknown'],
    },
    locationDesirability: {
      type: 'score',
      instructions: 'How desirable is the location? (0=remote, 1=developing, 2=established, 3=prime)',
      min: 0,
      max: 3,
    },
    photoQuality: {
      type: 'score',
      instructions: 'How good are the listing photos? (0=none, 1=poor, 2=good, 3=professional)',
      min: 0,
      max: 3,
    },
    descriptionCompleteness: {
      type: 'score',
      instructions: 'How complete is the description? (0=minimal, 1=basic, 2=detailed, 3=comprehensive)',
      min: 0,
      max: 3,
    },
  },

  batdongsan: {
    ...COMMON_QUESTIONS,
    pricePerM2: {
      type: 'score',
      instructions: 'How competitive is the price per m²? (0=overpriced, 1=market, 2=good, 3=great)',
      min: 0,
      max: 3,
    },
    legalStatus: {
      type: 'choice',
      instructions: 'What is the legal status clarity?',
      options: ['clear', 'pending', 'unclear', 'complex', 'unknown'],
    },
    projectReputation: {
      type: 'score',
      instructions: 'How reputable is the project/developer? (0=unknown, 1=small, 2=known, 3=top-tier)',
      min: 0,
      max: 3,
    },
    investmentPotential: {
      type: 'score',
      instructions: 'How strong is the investment potential signal? (0=low, 1=moderate, 2=good, 3=high)',
      min: 0,
      max: 3,
    },
    urgencyLevel: {
      type: 'score',
      instructions: 'How urgent is the sale? (0=flexible, 1=normal, 2=motivated, 3=urgent)',
      min: 0,
      max: 3,
    },
  },

  // ==========================================================================
  // E-COMMERCE PLATFORMS
  // ==========================================================================

  shopee: {
    ...COMMON_QUESTIONS,
    priceHook: {
      type: 'choice',
      instructions: 'What is the primary price hook?',
      options: ['lowestPrice', 'discount', 'bundle', 'flashSale', 'freeShipping', 'none'],
    },
    urgencyType: {
      type: 'choice',
      instructions: 'What urgency tactic is used?',
      options: ['flashSale', 'limitedStock', 'countdown', 'seasonal', 'none'],
    },
    socialProofLevel: {
      type: 'score',
      instructions: 'How strong is the social proof? (0=none, 1=few reviews, 2=many reviews, 3=best seller)',
      min: 0,
      max: 3,
    },
    discountDepth: {
      type: 'score',
      instructions: 'How deep is the discount? (0=none, 1=10-30%, 2=30-50%, 3=50%+)',
      min: 0,
      max: 3,
    },
    keywordOptimization: {
      type: 'score',
      instructions: 'How SEO-optimized is the product title? (0=poor, 1=some, 2=good, 3=excellent)',
      min: 0,
      max: 3,
    },
    sellerReputation: {
      type: 'score',
      instructions: 'How strong is the seller reputation signal? (0=new, 1=established, 2=trusted, 3=mall/preferred)',
      min: 0,
      max: 3,
    },
  },

  'tiktok-shop': {
    ...COMMON_QUESTIONS,
    viralPotential: {
      type: 'score',
      instructions: 'How viral is this product content? (0=low, 1=moderate, 2=high, 3=viral)',
      min: 0,
      max: 3,
    },
    influencerEndorsement: {
      type: 'noul',
      instructions: 'Is this product endorsed by an influencer or creator?',
    },
    priceCompetitiveness: {
      type: 'score',
      instructions: 'How competitive is the price? (0=high, 1=market, 2=good, 3=best)',
      min: 0,
      max: 3,
    },
    trendAlignment: {
      type: 'score',
      instructions: 'How aligned is this with current TikTok trends? (0=none, 1=somewhat, 2=aligned, 3=trending)',
      min: 0,
      max: 3,
    },
    urgencyLevel: {
      type: 'score',
      instructions: 'How urgent is the purchase push? (0=none, 1=soft, 2=moderate, 3=hard)',
      min: 0,
      max: 3,
    },
  },
};

/**
 * Get question set for a platform
 * @param {string} platform - Platform identifier
 * @returns {Object} Question set for Jev
 */
export function getPlatformQuestions(platform) {
  const questions = PLATFORM_QUESTIONS[platform];
  if (!questions) {
    throw new Error(`Platform '${platform}' not supported. Available: ${Object.keys(PLATFORM_QUESTIONS).join(', ')}`);
  }
  return questions;
}

/**
 * Get platform category
 * @param {string} platform - Platform identifier
 * @returns {string} Category: 'social' | 'recruitment' | 'realestate' | 'ecom'
 */
export function getPlatformCategory(platform) {
  const categories = {
    social: ['twitter', 'threads', 'facebook', 'tiktok', 'youtube', 'reddit', 'instagram', 'bluesky', 'mastodon', 'medium', 'zalo'],
    recruitment: ['linkedin', 'topcv', 'vietnamworks'],
    realestate: ['chotot', 'batdongsan'],
    ecom: ['shopee', 'tiktok-shop'],
  };
  
  for (const [category, platforms] of Object.entries(categories)) {
    if (platforms.includes(platform)) return category;
  }
  return 'unknown';
}

/**
 * List all supported platforms
 * @returns {string[]} Platform identifiers
 */
export function listPlatforms() {
  return Object.keys(PLATFORM_QUESTIONS);
}

/**
 * List platforms by category
 * @param {string} category - Category filter
 * @returns {string[]} Platform identifiers
 */
export function listPlatformsByCategory(category) {
  const categories = {
    social: ['twitter', 'threads', 'facebook', 'tiktok', 'youtube', 'reddit', 'instagram', 'bluesky', 'mastodon', 'medium', 'zalo'],
    recruitment: ['linkedin', 'topcv', 'vietnamworks'],
    realestate: ['chotot', 'batdongsan'],
    ecom: ['shopee', 'tiktok-shop'],
  };
  return categories[category] || [];
}
