// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Scheduled Crawl Jobs — dashboard logic for /api/schedule.
 * Admin-only endpoints: requires an admin JWT in localStorage.authToken.
 * Relies on globals from /js/config.js: CONFIG, apiRequest, showToast, requireAuth.
 * by nichxbt
 */
(function () {
  'use strict';

  if (!requireAuth()) return;

  const jobsBody = document.getElementById('jobsBody');
  const authNote = document.getElementById('authNote');
  const historyCard = document.getElementById('historyCard');
  const historyPanel = document.getElementById('historyPanel');
  const historyTitle = document.getElementById('historyTitle');
  const templateSel = document.getElementById('jobTemplate');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts = {}) {
    try {
      return await apiRequest(path, opts);
    } catch (err) {
      if (/forbidden|unauthorized|authentication|token/i.test(err.message || '')) {
        authNote.hidden = false;
      }
      throw err;
    }
  }

  function statusBadge(job) {
    if (!job.enabled) return '<span class="badge badge--off">disabled</span>';
    if (!job.lastStatus) return '<span class="badge badge--never">never ran</span>';
    return `<span class="badge badge--${job.lastStatus === 'success' ? 'success' : 'failed'}">${esc(job.lastStatus)}</span>`;
  }

  async function loadJobs() {
    try {
      const { jobs } = await api('/schedule');
      if (!jobs || jobs.length === 0) {
        jobsBody.innerHTML = '<tr><td colspan="6" class="empty">No scheduled jobs yet — create one above or pick a template.</td></tr>';
        return;
      }
      jobsBody.innerHTML = jobs.map((job) => `
        <tr>
          <td><strong>${esc(job.name)}</strong></td>
          <td><code>${esc(job.cron)}</code></td>
          <td class="cmd" title="${esc(job.command)}">${esc(job.command)}</td>
          <td>${statusBadge(job)}</td>
          <td>${job.lastRun ? new Date(job.lastRun).toLocaleString() : '—'}</td>
          <td><div class="row-actions">
            <button class="btn btn--sm" data-act="run" data-name="${esc(job.name)}">▶ Run</button>
            <button class="btn btn--sm" data-act="history" data-name="${esc(job.name)}">🕘</button>
            <button class="btn btn--sm" data-act="${job.enabled ? 'disable' : 'enable'}" data-name="${esc(job.name)}">${job.enabled ? '⏸' : '⏵'}</button>
            <button class="btn btn--sm btn--danger" data-act="delete" data-name="${esc(job.name)}">🗑</button>
          </div></td>
        </tr>`).join('');
    } catch (err) {
      showToast(`Failed to load jobs: ${err.message}`, 'error');
      jobsBody.innerHTML = '<tr><td colspan="6" class="empty">Could not load jobs.</td></tr>';
    }
  }

  async function loadTemplates() {
    try {
      const { templates } = await api('/schedule/templates');
      for (const t of templates || []) {
        const opt = document.createElement('option');
        opt.value = t.name;
        opt.textContent = `${t.name} — ${t.description || t.cron}`;
        opt.dataset.cron = t.cron;
        opt.dataset.command = t.command;
        templateSel.appendChild(opt);
      }
    } catch {}
  }

  templateSel.addEventListener('change', () => {
    const opt = templateSel.selectedOptions[0];
    if (!opt || !opt.value) return;
    document.getElementById('jobName').value = opt.value;
    document.getElementById('jobCron').value = opt.dataset.cron || '';
    document.getElementById('jobCommand').value = opt.dataset.command || '';
  });

  document.getElementById('createBtn').addEventListener('click', async () => {
    const name = document.getElementById('jobName').value.trim();
    const cron = document.getElementById('jobCron').value.trim();
    const command = document.getElementById('jobCommand').value.trim();
    if (!name || !cron) { showToast('Name and cron are required', 'error'); return; }
    try {
      await api('/schedule', { method: 'POST', body: JSON.stringify({ name, cron, command }) });
      showToast(`Job "${name}" scheduled`, 'success');
      document.getElementById('jobName').value = '';
      document.getElementById('jobCron').value = '';
      document.getElementById('jobCommand').value = '';
      templateSel.value = '';
      await loadJobs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  async function loadHistory(name) {
    try {
      const { history } = await api(`/schedule/${encodeURIComponent(name)}/history?limit=10`);
      historyCard.hidden = false;
      historyTitle.textContent = `History — ${name}`;
      if (!history || history.length === 0) {
        historyPanel.innerHTML = '<div class="empty">No runs recorded yet.</div>';
        return;
      }
      historyPanel.innerHTML = history.map((h) => `
        <div class="h-entry">
          <div><strong>${esc(h.startTime || '?')}</strong> · ${esc(h.status || '?')} · ${esc(h.duration || '')} · exit ${esc(h.exitCode ?? '?')}${h.retries ? ` · ${h.retries} retries` : ''}</div>
          ${h.outputPreview ? `<div style="color:var(--text-secondary); margin-top:4px;">${esc(h.outputPreview)}</div>` : ''}
        </div>`).join('');
      historyCard.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  jobsBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const name = btn.dataset.name;
    const act = btn.dataset.act;
    try {
      if (act === 'run') {
        btn.disabled = true;
        showToast(`Running "${name}"…`, 'info');
        const result = await api(`/schedule/${encodeURIComponent(name)}/run`, { method: 'POST' });
        showToast(result.status === 'failed' ? `"${name}" failed` : `"${name}" done`, result.status === 'failed' ? 'error' : 'success');
      } else if (act === 'enable' || act === 'disable') {
        await api(`/schedule/${encodeURIComponent(name)}/${act}`, { method: 'POST' });
        showToast(`"${name}" ${act}d`, 'success');
      } else if (act === 'delete') {
        if (!confirm(`Remove job "${name}"?`)) return;
        await api(`/schedule/${encodeURIComponent(name)}`, { method: 'DELETE' });
        showToast(`"${name}" removed`, 'success');
      } else if (act === 'history') {
        return loadHistory(name);
      }
      await loadJobs();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('refreshBtn').addEventListener('click', loadJobs);

  loadJobs();
  loadTemplates();
})();
