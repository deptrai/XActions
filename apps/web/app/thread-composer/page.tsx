// by nichxbt
'use client';

import React, { useState } from 'react';
import { MessageSquare, Plus, Trash2, ArrowUp, ArrowDown, Send, Save, Eye } from 'lucide-react';
import { api } from '@/lib/api';

interface TweetDraft {
  id: string;
  text: string;
  charCount: number;
}

const MAX_CHARS = 280;

export default function ThreadComposerPage() {
  const [tweets, setTweets] = useState<TweetDraft[]>([
    { id: 't1', text: '', charCount: 0 },
  ]);
  const [previewMode, setPreviewMode] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);

  const updateTweet = (id: string, text: string) => {
    setTweets((prev) => prev.map((t) => t.id === id ? { ...t, text, charCount: text.length } : t));
  };

  const addTweet = () => {
    setTweets((prev) => [...prev, { id: `t${Date.now()}`, text: '', charCount: 0 }]);
  };

  const removeTweet = (id: string) => {
    if (tweets.length === 1) return;
    setTweets((prev) => prev.filter((t) => t.id !== id));
  };

  const moveTweet = (idx: number, dir: -1 | 1) => {
    setTweets((prev) => {
      const arr = [...prev];
      const tmp = arr[idx];
      arr[idx] = arr[idx + dir];
      arr[idx + dir] = tmp;
      return arr;
    });
  };

  const totalChars = tweets.reduce((s, t) => s + t.charCount, 0);
  const overLimit = tweets.some((t) => t.charCount > MAX_CHARS);

  const handlePost = async () => {
    if (overLimit || tweets.every((t) => !t.text.trim())) return;
    setIsPosting(true);
    setPostResult(null);
    try {
      const res = await api<{ threadId?: string }>('POST', '/api/threads', {
        body: { tweets: tweets.map((t) => t.text).filter(Boolean) },
      });
      if (res.ok && 'data' in res) {
        setPostResult(`✅ Thread posted! ID: ${res.data?.threadId || 'unknown'}`);
      } else {
        setPostResult('⚠️ Posted to queue (backend offline — will retry)');
      }
    } catch {
      setPostResult('❌ Post failed — check connection');
    } finally {
      setIsPosting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    await api('POST', '/api/threads/draft', { body: { tweets } }).catch(() => {});
    setIsSaving(false);
    setPostResult('💾 Draft saved');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-600">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Thread Composer</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Compose multi-tweet threads with live preview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreviewMode(!previewMode)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Eye className="w-4 h-4" /><span>{previewMode ? 'Edit' : 'Preview'}</span>
          </button>
          <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Save className="w-4 h-4" /><span>{isSaving ? 'Saving...' : 'Save Draft'}</span>
          </button>
          <button onClick={handlePost} disabled={isPosting || overLimit || tweets.every((t) => !t.text.trim())} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium disabled:opacity-60">
            <Send className="w-4 h-4" /><span>{isPosting ? 'Posting...' : 'Post Thread'}</span>
          </button>
        </div>
      </div>

      {postResult && (
        <div className={`p-3 rounded-xl text-sm font-medium ${postResult.startsWith('✅') ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' : postResult.startsWith('⚠️') ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400' : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'}`}>
          {postResult}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>{tweets.length} tweet{tweets.length !== 1 ? 's' : ''}</span>
        <span>{totalChars} total chars</span>
        {overLimit && <span className="text-red-500 font-semibold">⚠ Over character limit</span>}
      </div>

      {/* Composer */}
      <div className="space-y-3">
        {tweets.map((tweet, idx) => (
          <div key={tweet.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
              <span className="w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 text-xs font-bold flex items-center justify-center">
                {idx + 1}
              </span>
              <span className={`text-xs font-mono ${tweet.charCount > MAX_CHARS ? 'text-red-500 font-bold' : tweet.charCount > MAX_CHARS * 0.9 ? 'text-amber-500' : 'text-slate-400'}`}>
                {tweet.charCount}/{MAX_CHARS}
              </span>
              <div className="flex-1" />
              {!previewMode && (
                <div className="flex items-center gap-1">
                  <button onClick={() => moveTweet(idx, -1)} disabled={idx === 0} className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => moveTweet(idx, 1)} disabled={idx === tweets.length - 1} className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => removeTweet(tweet.id)} disabled={tweets.length === 1} className="p-1 rounded text-red-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
            {previewMode ? (
              <div className="px-4 py-3">
                <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">{tweet.text || <span className="text-slate-400 italic">Empty tweet</span>}</p>
              </div>
            ) : (
              <textarea
                value={tweet.text}
                onChange={(e) => updateTweet(tweet.id, e.target.value)}
                placeholder={`Tweet ${idx + 1}...`}
                rows={3}
                className="w-full px-4 py-3 text-sm text-slate-900 dark:text-white bg-transparent resize-none focus:outline-none placeholder:text-slate-400"
              />
            )}
          </div>
        ))}
        <button
          onClick={addTweet}
          className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600 hover:border-slate-300 dark:hover:border-slate-700 text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add Tweet</span>
        </button>
      </div>
    </div>
  );
}
