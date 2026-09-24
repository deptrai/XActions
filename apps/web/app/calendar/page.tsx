// by nichxbt
'use client';

import React, { useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock, Plus } from 'lucide-react';
import { api } from '@/lib/api';

interface CalEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string;
  type: 'post' | 'job' | 'report' | 'dm';
  status: 'scheduled' | 'done' | 'failed';
}

const TYPE_COLORS: Record<string, string> = {
  post: 'bg-blue-500',
  job: 'bg-purple-500',
  report: 'bg-emerald-500',
  dm: 'bg-amber-500',
};

const SEEDED_EVENTS: CalEvent[] = [
  { id: 'e1', title: 'Morning thread post', date: '2026-09-24', time: '08:00', type: 'post', status: 'done' },
  { id: 'e2', title: 'Trending scrape job', date: '2026-09-24', time: '12:00', type: 'job', status: 'done' },
  { id: 'e3', title: 'Evening engagement post', date: '2026-09-24', time: '18:00', type: 'post', status: 'scheduled' },
  { id: 'e4', title: 'Weekly report', date: '2026-09-25', time: '09:00', type: 'report', status: 'scheduled' },
  { id: 'e5', title: 'Follower check', date: '2026-09-25', time: '14:00', type: 'job', status: 'scheduled' },
  { id: 'e6', title: 'DM campaign batch', date: '2026-09-26', time: '10:00', type: 'dm', status: 'scheduled' },
  { id: 'e7', title: 'Viral miner run', date: '2026-09-28', time: '06:00', type: 'job', status: 'scheduled' },
  { id: 'e8', title: 'Thread: AI trends', date: '2026-09-29', time: '08:00', type: 'post', status: 'scheduled' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [events, setEvents] = useState<CalEvent[]>(SEEDED_EVENTS);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const getEventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter((e) => e.date === dateStr);
  };

  const selectedEvents = selectedDay ? events.filter((e) => e.date === selectedDay) : [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600">
              <Calendar className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Content Calendar</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Scheduled posts, jobs, and campaigns at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-900 dark:text-white w-36 text-center">
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-800">
            {DAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">{d}</div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} className="h-20 border-b border-r border-slate-50 dark:border-slate-800/30" />;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayEvents = getEventsForDay(day);
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              const isSelected = selectedDay === dateStr;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(isSelected ? null : dateStr)}
                  className={`h-20 p-1.5 border-b border-r border-slate-50 dark:border-slate-800/30 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                    isSelected ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''
                  }`}
                >
                  <span className={`text-xs font-semibold inline-flex w-5 h-5 items-center justify-center rounded-full ${
                    isToday ? 'bg-emerald-500 text-white' : 'text-slate-700 dark:text-slate-300'
                  }`}>
                    {day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayEvents.slice(0, 2).map((e) => (
                      <div key={e.id} className={`text-[10px] px-1 py-0.5 rounded text-white truncate ${TYPE_COLORS[e.type]}`}>
                        {e.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <p className="text-[10px] text-slate-400">+{dayEvents.length - 2} more</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Day Detail Panel */}
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
              {selectedDay ? `Events — ${selectedDay}` : 'Select a day'}
            </h3>
            {selectedDay ? (
              selectedEvents.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No events scheduled.</p>
              ) : (
                <div className="space-y-2">
                  {selectedEvents.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${TYPE_COLORS[e.type]}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{e.title}</p>
                        <p className="text-xs text-slate-400">{e.time} · {e.type}</p>
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        e.status === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                        : e.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                      }`}>{e.status}</span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p className="text-sm text-slate-400 italic">Click a day to see scheduled events.</p>
            )}
          </div>

          {/* Legend */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Event Types</h3>
            <div className="space-y-1.5">
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-sm ${color}`} />
                  <span className="text-xs text-slate-600 dark:text-slate-400 capitalize">{type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
