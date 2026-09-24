'use client';

import React, { useState } from 'react';
import {
  Users,
  Search,
  Tag,
  Star,
  Plus,
  Filter,
  CheckCircle2,
  TrendingUp,
  UserCheck,
  Mail,
  ExternalLink,
} from 'lucide-react';

interface Contact {
  id: string;
  handle: string;
  name: string;
  avatar: string;
  bio: string;
  followers: number;
  leadScore: number;
  tags: string[];
}

const INITIAL_CONTACTS: Contact[] = [
  {
    id: '1',
    handle: 'alex_growth',
    name: 'Alex Rivera',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
    bio: 'Founder @SaaSBoost | Scaling B2B products to $10M ARR. Obsessed with viral growth loops & outbound sales.',
    followers: 48500,
    leadScore: 95,
    tags: ['VIP', 'Founder', 'B2B', 'High-ICP'],
  },
  {
    id: '2',
    handle: 'sarah_tech',
    name: 'Sarah Chen',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop',
    bio: 'AI Engineer & Builder. Ex-OpenAI researcher. Writing about autonomous agent frameworks and LLM fine-tuning.',
    followers: 32100,
    leadScore: 88,
    tags: ['AI-Builder', 'Researcher', 'VIP'],
  },
  {
    id: '3',
    handle: 'david_invest',
    name: 'David Miller',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    bio: 'Angel Investor in early-stage devtools & creator economy. 40+ portfolio companies.',
    followers: 89400,
    leadScore: 92,
    tags: ['Investor', 'VIP', 'Decisor'],
  },
  {
    id: '4',
    handle: 'elena_content',
    name: 'Elena Rostova',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop',
    bio: 'Ghostwriter for tech founders. Generated 25M+ impressions in 2025. Sharing weekly storytelling teardowns.',
    followers: 18200,
    leadScore: 76,
    tags: ['Creator', 'Copywriter'],
  },
  {
    id: '5',
    handle: 'mike_devops',
    name: 'Mike Kowalski',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    bio: 'Staff SRE @CloudScale. Kubernetes, Rust, Distributed Systems, High Availability.',
    followers: 12400,
    leadScore: 68,
    tags: ['Engineer', 'SRE'],
  },
];

export default function FollowerCrmPage() {
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [search, setSearch] = useState('');
  const [selectedSegment, setSelectedSegment] = useState<'all' | 'vip' | 'founder' | 'ai'>('all');
  const [newTagInput, setNewTagInput] = useState<{ [contactId: string]: string }>({});

  const handleAddTag = async (contactId: string) => {
    const tag = (newTagInput[contactId] || '').trim();
    if (!tag) return;

    // Optimistic UI update
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId && !c.tags.includes(tag) ? { ...c, tags: [...c.tags, tag] } : c))
    );
    setNewTagInput((prev) => ({ ...prev, [contactId]: '' }));

    // Try posting to backend API
    try {
      await fetch('http://localhost:3001/api/crm/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, tag }),
      });
    } catch {}
  };

  const filteredContacts = contacts.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.handle.toLowerCase().includes(search.toLowerCase()) ||
      c.bio.toLowerCase().includes(search.toLowerCase()) ||
      c.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedSegment === 'vip') return c.leadScore >= 80;
    if (selectedSegment === 'founder') return c.tags.includes('Founder') || c.bio.toLowerCase().includes('founder');
    if (selectedSegment === 'ai') return c.tags.includes('AI-Builder') || c.bio.toLowerCase().includes('ai');

    return true;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600">
              <Users className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Follower CRM & Contact Intelligence
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Segment high-value followers, track Lead ICP Scores, and organize VIP outreach pipeline.
          </p>
        </div>

        {/* Stats Summary */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-right">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Total Tracked</span>
            <span className="text-base font-bold text-slate-900 dark:text-white">{contacts.length} VIP Leads</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, handle, bio, or tags..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Segment Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-semibold">
          <button
            onClick={() => setSelectedSegment('all')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedSegment === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            All Contacts ({contacts.length})
          </button>
          <button
            onClick={() => setSelectedSegment('vip')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedSegment === 'vip'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            VIPs (Score ≥ 80)
          </button>
          <button
            onClick={() => setSelectedSegment('founder')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedSegment === 'founder'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Founders
          </button>
          <button
            onClick={() => setSelectedSegment('ai')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedSegment === 'ai'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            AI Builders
          </button>
        </div>
      </div>

      {/* Contacts List Cards */}
      <div className="space-y-3.5">
        {filteredContacts.map((contact) => (
          <div
            key={contact.id}
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group"
          >
            {/* Left: Avatar & Info */}
            <div className="flex items-start gap-4 max-w-2xl">
              <img
                src={contact.avatar}
                alt={contact.name}
                className="w-12 h-12 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-800"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {contact.name}
                  </h3>
                  <a
                    href={`https://x.com/${contact.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                  >
                    @{contact.handle}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className="text-xs text-slate-400">• {contact.followers.toLocaleString()} followers</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {contact.bio}
                </p>

                {/* Tags */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                  {contact.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                    >
                      #{tag}
                    </span>
                  ))}

                  {/* Add Tag inline input */}
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      placeholder="Add tag..."
                      value={newTagInput[contact.id] || ''}
                      onChange={(e) =>
                        setNewTagInput({ ...newTagInput, [contact.id]: e.target.value })
                      }
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag(contact.id)}
                      className="px-2 py-0.5 text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white w-20 focus:w-28 transition-all focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleAddTag(contact.id)}
                      className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 text-xs"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Lead Score & Actions */}
            <div className="flex items-center md:flex-col md:items-end justify-between gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Lead Score</span>
                <span
                  className={`text-lg font-black ${
                    contact.leadScore >= 85
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : contact.leadScore >= 70
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {contact.leadScore}/100
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
