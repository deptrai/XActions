// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt — Instagram validator unit tests.
import { describe, it, expect } from 'vitest';
import {
  InstagramPlatformResponseValidator,
  ValidationError,
  validateInstagramPost,
} from '../../../../src/scrapers/social/instagram/validator.js';

const v = new InstagramPlatformResponseValidator();

describe('isBotChallenge / isRateLimit / isLoginWall', () => {
  it('detects challenge_required', () => {
    expect(v.isBotChallenge({ status: 403, body: '{"message":"challenge_required"}' })).toBe(true);
    expect(v.isBotChallenge({ error_type: 'checkpoint_required' })).toBe(true);
    expect(v.isBotChallenge({ body: 'Please verify your account /challenge/' })).toBe(true);
  });
  it('detects 429 + feedback_required as rate limit', () => {
    expect(v.isRateLimit({ status: 429 })).toBe(true);
    expect(v.isRateLimit({ error_type: 'feedback_required' })).toBe(true);
    expect(v.isRateLimit({ body: 'Please wait a few minutes before you try again' })).toBe(true);
  });
  it('detects login wall on 401 + login markers', () => {
    expect(v.isLoginWall({ status: 401 })).toBe(true);
    expect(v.isLoginWall({ body: '<title>Login • Instagram</title>' })).toBe(true);
    expect(v.isLoginWall({ error_type: 'login_required' })).toBe(true);
  });
});

describe('isValidPayload', () => {
  it('rejects block pages', () => {
    expect(v.isValidPayload({ status: 403, body: 'challenge_required' })).toBe(false);
    expect(v.isValidPayload({ status: 429 })).toBe(false);
    expect(v.isValidPayload({ status: 401, body: 'login_required' })).toBe(false);
  });
  it('accepts GraphQL / media shapes', () => {
    expect(v.isValidPayload({ data: { user: {} } })).toBe(true);
    expect(v.isValidPayload({ graphql: { shortcode_media: {} } })).toBe(true);
    expect(v.isValidPayload({ items: [] })).toBe(true);
    expect(v.isValidPayload({ pk: 1, code: 'x' })).toBe(true);
  });
  it('rejects empty/empty-object payloads', () => {
    expect(v.isValidPayload({})).toBe(false);
    expect(v.isValidPayload(null)).toBe(false);
  });
});

describe('validatePost (AC-8)', () => {
  it('returns true for a valid media object', () => {
    expect(v.validatePost({ pk: 1, code: 'x', taken_at: 1700000000, caption: { text: 'hi' } })).toBe(true);
    expect(validateInstagramPost({ id: 'a', shortcode: 'x', taken_at: 1, caption: 'y' })).toBe(true);
  });
  it('throws ValidationError listing every missing field', () => {
    let err;
    try { v.validatePost({ pk: 1 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe('ValidationError');
    expect(err.missing).toEqual(expect.arrayContaining(['code', 'taken_at']));
    expect(err.missing).not.toContain('pk');
    expect(err.statusCode).toBe(400);
  });
  it('throws when pk/id absent', () => {
    expect(() => v.validatePost({ code: 'x', taken_at: 1, caption: 'c' })).toThrow(ValidationError);
  });
  it('accepts caption-less media by default; strict mode still requires caption', () => {
    expect(v.validatePost({ pk: 1, code: 'x', taken_at: 1 })).toBe(true);
    expect(() => v.validatePost({ pk: 1, code: 'x', taken_at: 1 }, { requireCaption: true })).toThrow(ValidationError);
  });
});


describe('validateUser / validateComment', () => {
  it('validates user requires pk + username', () => {
    expect(v.validateUser({ pk: 1, username: 'x' })).toBe(true);
    expect(() => v.validateUser({ username: 'x' })).toThrow(ValidationError);
  });
  it('validates comment requires pk + text', () => {
    expect(v.validateComment({ pk: 1, text: 'hi' })).toBe(true);
    expect(() => v.validateComment({ pk: 1 })).toThrow(ValidationError);
  });
});
