// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DocIdStore,
  mapFriendlyName,
  getActiveDocIdStore,
  setActiveDocIdStore,
  loadStoredDocIdsSync,
  noteDocIdFailure,
} from '../../../../src/scrapers/social/facebook/doc-id-store.js';

describe('Facebook doc_id store (capture persistence + auto-refresh bookkeeping)', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-docids-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setActiveDocIdStore(null);
  });

  describe('mapFriendlyName', () => {
    it('maps known Relay operation names to crawler ACTION keys', () => {
      expect(mapFriendlyName('CommentsListComponentsPaginationQuery_facebookRelayOperation')).toBe('COMMENT_ROOTS');
      expect(mapFriendlyName('Depth1CommentsListPaginationQuery_facebookRelayOperation')).toBe('COMMENT_REPLIES');
      expect(mapFriendlyName('Depth2CommentsListPaginationQuery_facebookRelayOperation')).toBe('COMMENT_REPLIES_DEPTH2');
    });

    it('maps feed/profile/search heuristics', () => {
      expect(mapFriendlyName('GroupsCometFeedRegularStoriesQuery')).toBe('GROUP_FEED');
      expect(mapFriendlyName('PagesFeedPageReactQuery')).toBe('PAGE_FEED');
      expect(mapFriendlyName('ProfileCometFeedQuery')).toBe('PAGE_FEED'); // feed rule precedes profile rule
      expect(mapFriendlyName('ProfileCometHeaderQuery')).toBe('PROFILE');
      expect(mapFriendlyName('SearchPostsQuery')).toBe('SEARCH_POSTS');
      expect(mapFriendlyName('SearchPeopleQuery')).toBe('SEARCH_PEOPLE');
      expect(mapFriendlyName('GroupsSearchQuery')).toBe('GROUP_SEARCH'); // "groups" before "search"
      expect(mapFriendlyName('SearchGroupsQuery')).toBe('SEARCH_GROUPS'); // "search" before "groups"
      expect(mapFriendlyName('MarketplaceSearchContentContainerQuery')).toBe('MARKETPLACE_SEARCH');
    });

    it('returns null for unknown/empty names', () => {
      expect(mapFriendlyName('SomeRandomRelayOperation')).toBeNull();
      expect(mapFriendlyName('')).toBeNull();
      expect(mapFriendlyName(null)).toBeNull();
    });
  });

  describe('DocIdStore CRUD', () => {
    it('set/get/toDocIdMap round-trips and resets failCount on fresh capture', () => {
      const store = new DocIdStore(path.join(tmpDir, 'crud.json'));
      store.set('PROFILE', { docId: '111', friendlyName: 'ProfileCometHeaderQuery' });
      expect(store.get('PROFILE').docId).toBe('111');
      expect(store.get('PROFILE').failCount).toBe(0);

      store.markFailedByDocId('111');
      store.markFailedByDocId('111');
      expect(store.get('PROFILE').failCount).toBe(2);

      store.set('PROFILE', { docId: '222' }); // re-capture resets bookkeeping
      expect(store.get('PROFILE').docId).toBe('222');
      expect(store.get('PROFILE').failCount).toBe(0);

      expect(store.toDocIdMap()).toEqual({ PROFILE: '222' });
    });

    it('markFailedByDocId returns the owning action key, null for unknown ids', () => {
      const store = new DocIdStore(path.join(tmpDir, 'fail.json'));
      store.set('PAGE_FEED', { docId: '333' });
      expect(store.markFailedByDocId('333')).toBe('PAGE_FEED');
      expect(store.markFailedByDocId('999999')).toBeNull();
      expect(store.markFailedByDocId(null)).toBeNull();
    });

    it('saveSync/loadSync round-trips docIds, extra queries and tokens', () => {
      const file = path.join(tmpDir, 'nested', 'dir', 'store.json');
      const writer = new DocIdStore(file);
      writer.set('PROFILE', { docId: '444', friendlyName: 'ProfileCometHeaderQuery' });
      writer.setExtra('UnmappedQuery_facebookRelayOperation', { docId: '555' });
      writer.setTokens({ fb_dtsg: 'dtsg-token', lsd: 'lsd-token', jazoest: '' });
      writer.markCaptured('cli-capture');
      writer.saveSync();

      const reader = new DocIdStore(file).loadSync();
      expect(reader.get('PROFILE').docId).toBe('444');
      expect(reader.toJSON().extra.UnmappedQuery_facebookRelayOperation.docId).toBe('555');
      expect(reader.toJSON().tokens).toEqual({ fb_dtsg: 'dtsg-token', lsd: 'lsd-token' });
      expect(reader.toJSON().source).toBe('cli-capture');
      expect(reader.needsRefresh()).toBe(false);
    });

    it('loadSync on a missing/corrupt file resets to empty and needsRefresh() is true', () => {
      const missing = new DocIdStore(path.join(tmpDir, 'nope.json')).loadSync();
      expect(missing.getStats().total).toBe(0);
      expect(missing.needsRefresh()).toBe(true);

      const corrupt = path.join(tmpDir, 'corrupt.json');
      fs.writeFileSync(corrupt, '{not json');
      expect(new DocIdStore(corrupt).loadSync().getStats().total).toBe(0);
    });

    it('needsRefresh honors maxAgeMs', () => {
      const store = new DocIdStore(path.join(tmpDir, 'age.json'));
      store.markCaptured();
      expect(store.needsRefresh(60_000)).toBe(false);
      expect(store.needsRefresh(-1)).toBe(true); // already older than -1ms
    });
  });

  describe('active store wiring', () => {
    it('loadStoredDocIdsSync reads through the active store', () => {
      const file = path.join(tmpDir, 'active.json');
      const store = new DocIdStore(file);
      store.set('GROUP_FEED', { docId: '666' });
      store.saveSync();
      setActiveDocIdStore(store);
      expect(loadStoredDocIdsSync()).toEqual({ GROUP_FEED: '666' });
    });

    it('noteDocIdFailure persists failCount without throwing for unknown ids', () => {
      const file = path.join(tmpDir, 'note.json');
      const store = new DocIdStore(file);
      store.set('SEARCH_POSTS', { docId: '777' });
      store.saveSync();
      setActiveDocIdStore(store);

      expect(noteDocIdFailure('777')).toBe('SEARCH_POSTS');
      expect(new DocIdStore(file).loadSync().get('SEARCH_POSTS').failCount).toBe(1);

      // Unknown doc_id (e.g. a placeholder default) is a no-op, never a throw.
      expect(noteDocIdFailure('profile_doc_789')).toBeNull();
      expect(noteDocIdFailure(undefined)).toBeNull();
    });

    it('getActiveDocIdStore lazily creates a loaded store', () => {
      setActiveDocIdStore(null);
      const active = getActiveDocIdStore();
      expect(active).toBeInstanceOf(DocIdStore);
      expect(getActiveDocIdStore()).toBe(active); // cached
    });
  });
});
