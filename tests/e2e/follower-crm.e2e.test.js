// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Follower CRM & Contact Intelligence Pipeline
 *
 * Verifies end-to-end flow:
 * 1. Contact upsert and tag management
 * 2. Contact search by keyword / username / bio
 * 3. Dynamic segment creation and member retrieval
 * 4. Automatic lead and engagement scoring
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  tagContact,
  searchContacts,
  createSegment,
  getSegment,
  autoScore,
  scoreContact,
} from '../../src/analytics/followerCRM.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-follower-crm';

describe('CRM — Follower Contact Intelligence & Segmentation E2E', () => {
  beforeAll(() => {
    const dbDir = path.join(os.homedir(), '.xactions');
    fs.mkdirSync(dbDir, { recursive: true });
    const db = new Database(path.join(dbDir, 'analytics.db'));

    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT,
        bio TEXT,
        followers_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        tweet_count INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0,
        protected INTEGER DEFAULT 0,
        follow_date TEXT,
        unfollow_date TEXT,
        is_follower INTEGER DEFAULT 0,
        is_following INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        last_active TEXT,
        profile_image_url TEXT,
        location TEXT,
        website TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS crm_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#1DA1F2',
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS crm_contact_tags (
        contact_id INTEGER,
        tag_id INTEGER,
        PRIMARY KEY (contact_id, tag_id),
        FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES crm_tags(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        filter_json TEXT NOT NULL,
        created_at TEXT
      );
    `);

    // Seed test contacts
    const upsert = db.prepare(`
      INSERT INTO crm_contacts (username, display_name, bio, followers_count, following_count, tweet_count, verified, is_follower, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        display_name = excluded.display_name,
        bio = excluded.bio,
        followers_count = excluded.followers_count,
        following_count = excluded.following_count,
        tweet_count = excluded.tweet_count,
        verified = excluded.verified,
        is_follower = excluded.is_follower,
        updated_at = excluded.updated_at
    `);

    upsert.run('alice_crypto', 'Alice Web3', 'Crypto and AI builder', 5000, 200, 1500, 1, 1, new Date().toISOString());
    upsert.run('bob_tech', 'Bob AI', 'Machine Learning engineer', 2500, 150, 800, 0, 1, new Date().toISOString());
    upsert.run('charlie_founder', 'Charlie F', 'Startup founder building tools', 12000, 500, 4500, 1, 1, new Date().toISOString());
    db.close();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] tagContact associates tag with contact in SQLite database`, () => {
    const res = tagContact('alice_crypto', 'vip-builder');
    expect(res).toBeDefined();
    expect(res.status).toBe('tagged');
    expect(res.username).toBe('alice_crypto');
    expect(res.tag).toBe('vip-builder');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] searchContacts finds contacts by username and bio keyword`, () => {
    const searchByName = searchContacts('alice');
    expect(searchByName.length).toBeGreaterThan(0);
    expect(searchByName.some((c) => c.username === 'alice_crypto')).toBe(true);

    const searchByBio = searchContacts('machine learning');
    expect(searchByBio.length).toBeGreaterThan(0);
    expect(searchByBio.some((c) => c.username === 'bob_tech')).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] createSegment and getSegment filter contacts based on criteria`, () => {
    createSegment('high_influence', { minFollowers: 3000 });
    const res = getSegment('high_influence');

    expect(res).toBeDefined();
    expect(Array.isArray(res.contacts)).toBe(true);
    expect(res.contacts.length).toBeGreaterThanOrEqual(2);
    expect(res.contacts.map((m) => m.username)).toContain('alice_crypto');
    expect(res.contacts.map((m) => m.username)).toContain('charlie_founder');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] autoScore calculates heuristic engagement score for a contact`, () => {
    const res = autoScore('charlie_founder');
    expect(res).toBeDefined();
    expect(res.username).toBe('charlie_founder');
    expect(typeof res.score).toBe('number');
    expect(res.score).toBeGreaterThan(0);
  });
});
