// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Jev Brain Type Declarations
// by nichxbt

export interface JevQuestion {
  type: 'choice' | 'score' | 'noul';
  instructions: string;
  criteria?: Record<string, string> | string[];
}

export interface JevAnswerChoice {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface JevAnswerScore {
  type: 'score';
  score: number;
  confidence: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
}

export interface JevAnswerNoul {
  type: 'noul';
  noul: number;
}

export type JevAnswer = JevAnswerChoice | JevAnswerScore | JevAnswerNoul;

export interface JevConfig {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  confidenceThresholds?: Record<string, number>;
  fallbackLLM?: any;
  dailyBudgetUsd?: number;
}

export interface JevDecisionResult {
  answers: Record<string, JevAnswer | any>;
  usage: { input_tokens: number; output_tokens: number };
  meta: {
    degraded: boolean;
    reason?: string;
    source: 'jev' | 'llmbrain';
  };
}

export class JevBrain {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  confidenceThresholds: Record<string, number>;
  dailyBudgetUsd: number;
  fallbackLLM: any;
  onUsage: ((model: string, inputTokens: number, outputTokens: number) => void) | null;

  constructor(config?: JevConfig);

  decide(
    state: string | Record<string, any> | any[],
    questions: Record<string, JevQuestion>,
    options?: { model?: string; timeoutMs?: number }
  ): Promise<JevDecisionResult>;

  gate(
    answer?: { confidence?: number; noul?: number },
    options?: { hi?: number; mid?: number; action?: string }
  ): 'act' | 'review' | 'skip';

  getUsageToday(): { calls: number; inputTokens: number; outputTokens: number };
}
