// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Viral DNA Miner — Frontend Logic
 * 
 * Story 45.5: Dashboard UI for viral mining, stats viewing, backtest.
 */

// Platform configuration
const PLATFORMS = {
  social: ['twitter', 'threads', 'facebook', 'tiktok', 'youtube', 'reddit', 'instagram', 'bluesky', 'mastodon', 'medium', 'zalo'],
  recruitment: ['linkedin', 'topcv', 'vietnamworks'],
  realestate: ['chotot', 'batdongsan'],
  ecom: ['shopee', 'tiktok-shop'],
};

const API_BASE = '/api/viral';

// State
let currentJobId = null;
let pollInterval = null;
let startTime = null;

// DOM Elements
const categorySelect = document.getElementById('category');
const platformSelect = document.getElementById('platform');
const nicheInput = document.getElementById('niche');
const countSlider = document.getElementById('count');
const countValue = document.getElementById('countValue');
const runBtn = document.getElementById('runMining');
const cancelBtn = document.getElementById('cancelMining');
const progressSection = document.getElementById('progressSection');
const resultsSection = document.getElementById('resultsSection');
const emptyState = document.getElementById('emptyState');
const progressBar = document.getElementById('progressBar');
const statScraped = document.getElementById('statScraped');
const statClassified = document.getElementById('statClassified');
const statCost = document.getElementById('statCost');
const statTime = document.getElementById('statTime');
const hookTypeChart = document.getElementById('hookTypeChart');
const patternsList = document.getElementById('patternsList');
const runBacktestBtn = document.getElementById('runBacktest');
const backtestResults = document.getElementById('backtestResults');

// Initialize
function init() {
  updatePlatformOptions();
  setupEventListeners();
  checkForExistingStats();
}

// Update platform dropdown based on category
function updatePlatformOptions() {
  const category = categorySelect.value;
  const platforms = PLATFORMS[category] || [];
  
  platformSelect.innerHTML = platforms.map(p => 
    `<option value="${p}">${formatPlatformName(p)}</option>`
  ).join('');
}

function formatPlatformName(platform) {
  return platform
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Event listeners
function setupEventListeners() {
  categorySelect.addEventListener('change', updatePlatformOptions);
  countSlider.addEventListener('input', (e) => {
    countValue.textContent = e.target.value;
  });
  
  runBtn.addEventListener('click', startMining);
  cancelBtn.addEventListener('click', cancelMining);
  runBacktestBtn.addEventListener('click', runBacktest);
  
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'compare') {
        loadPlatformComparison();
      }
    });
  });
}

// Check for existing stats
async function checkForExistingStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    const data = await res.json();
    if (data.stats && data.stats.length > 0) {
      const latest = data.stats[0];
      categorySelect.value = latest.category || 'social';
      updatePlatformOptions();
      platformSelect.value = latest.platform;
      nicheInput.value = latest.niche;
      await loadResults(latest.platform, latest.niche);
    }
  } catch (err) {
    console.log('No existing stats');
  }
}

// Start mining job
async function startMining() {
  const platform = platformSelect.value;
  const niche = nicheInput.value.trim();
  const count = parseInt(countSlider.value);
  
  if (!niche) {
    alert('Please enter a niche keyword');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/mine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, niche, count }),
    });
    
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Mining failed to start');
    }
    
    currentJobId = data.jobId;
    startTime = Date.now();
    
    // Show progress section
    progressSection.classList.add('active');
    resultsSection.classList.remove('active');
    emptyState.style.display = 'none';
    
    // Start polling
    pollJobStatus();
    
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Poll job status
function pollJobStatus() {
  pollInterval = setInterval(async () => {
    if (!currentJobId) return;
    
    try {
      const res = await fetch(`${API_BASE}/mine/${currentJobId}`);
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.message);
      }
      
      const job = data.job;
      updateProgress(job);
      
      if (job.status === 'completed') {
        clearInterval(pollInterval);
        await loadResults();
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        clearInterval(pollInterval);
        alert(`Job ${job.status}: ${job.error || 'Unknown error'}`);
      }
      
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, 5000); // Poll every 5s
}

// Update progress UI
function updateProgress(job) {
  const { progress, cost } = job;
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  
  statScraped.textContent = progress?.scraped || 0;
  statClassified.textContent = progress?.classified || 0;
  statCost.textContent = cost?.formatted || '$0.00';
  statTime.textContent = `${elapsed}s`;
  
  const percentage = progress ? Math.round((progress.classified / progress.total) * 100) : 0;
  progressBar.style.width = `${percentage}%`;
}

// Cancel mining
async function cancelMining() {
  if (!currentJobId) return;
  
  try {
    await fetch(`${API_BASE}/mine/${currentJobId}`, { method: 'DELETE' });
    clearInterval(pollInterval);
    progressSection.classList.remove('active');
    alert('Mining job cancelled');
  } catch (err) {
    alert(`Error cancelling: ${err.message}`);
  }
}

// Load results
async function loadResults(p, n) {
  const platform = p || platformSelect.value;
  const niche = (n || nicheInput.value).trim();
  if (!platform || !niche) return;
  
  try {
    const res = await fetch(`${API_BASE}/stats/${platform}/${niche}`);
    const data = await res.json();
    
    if (data.success && data.stats) {
      displayResults(data.stats);
      resultsSection.classList.add('active');
      emptyState.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load results:', err);
  }
}

// Display results
function displayResults(stats) {
  // Hook type chart
  const distribution = stats.hookTypeDistribution || {};
  const entries = Object.entries(distribution);
  const maxRate = Math.max(...entries.map(([_, d]) => d.viralRate || 0));
  
  hookTypeChart.innerHTML = entries.map(([hook, data]) => {
    const height = maxRate > 0 ? (data.viralRate / maxRate) * 100 : 0;
    return `
      <div class="chart-bar" style="height: ${height}%">
        <span class="chart-bar-value">${data.viralRate?.toFixed(2) || 0}%</span>
        <span class="chart-bar-label">${hook}</span>
      </div>
    `;
  }).join('');
  
  // Top patterns
  const patterns = stats.topPerformingPatterns || [];
  patternsList.innerHTML = patterns.slice(0, 5).map((p, i) => `
    <div class="pattern-item">
      <strong>#${i + 1}</strong>
      <span class="pattern-engagement">${p.avgEngagement?.toFixed(0) || 0} avg engagement</span>
      <div class="pattern-attrs">${JSON.stringify(p.attributes)}</div>
    </div>
  `).join('');
}

// Run backtest
async function runBacktest() {
  const platform = platformSelect.value;
  const niche = nicheInput.value.trim();
  
  try {
    const res = await fetch(`${API_BASE}/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, niche, days: 7 }),
    });
    
    const data = await res.json();
    
    if (data.success) {
      backtestResults.innerHTML = `
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-value good">${(data.report?.metrics?.precision * 100 || 0).toFixed(0)}%</div>
            <div class="metric-label">Precision</div>
          </div>
          <div class="metric-card">
            <div class="metric-value medium">${(data.report?.metrics?.recall * 100 || 0).toFixed(0)}%</div>
            <div class="metric-label">Recall</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${data.report?.sampleSize || 0}</div>
            <div class="metric-label">Sample Size</div>
          </div>
        </div>
        <p>${data.report?.summary || 'Backtest complete'}</p>
      `;
    }
  } catch (err) {
    backtestResults.innerHTML = `<p>Error: ${err.message}</p>`;
  }
}


// Setup and render cross-platform comparison
async function loadPlatformComparison() {
  const container = document.getElementById('platformComparison');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/stats`);
    const data = await res.json();
    const statsList = data.stats || [];

    if (statsList.length < 2) {
      container.innerHTML = `
        <p style="color: #666;">Need at least 2 mined datasets to compare. Currently available: ${statsList.length}.</p>
        <p style="font-size: 0.875rem; color: #888;">Available: ${statsList.map(s => `${s.platform}/${s.niche}`).join(', ') || 'None'}</p>
      `;
      return;
    }

    // Load full stats for each dataset
    const loadedDatasets = [];
    for (const item of statsList) {
      try {
        const itemRes = await fetch(`${API_BASE}/stats/${item.platform}/${item.niche}`);
        const itemData = await itemRes.json();
        if (itemData.success && itemData.stats) {
          loadedDatasets.push(itemData.stats);
        }
      } catch {}
    }

    if (loadedDatasets.length === 0) {
      container.innerHTML = '<p>Failed to load dataset details for comparison.</p>';
      return;
    }

    // Build comparison table & cards
    container.innerHTML = `
      <div style="margin-bottom: 1.5rem;">
        <h4 style="margin-bottom: 0.5rem;">Comparing ${loadedDatasets.length} Datasets Across Platforms:</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-top: 1rem;">
          ${loadedDatasets.map(ds => {
            const topHooks = Object.entries(ds.hookTypeDistribution || {})
              .sort((a, b) => (b[1].viralRate || 0) - (a[1].viralRate || 0))
              .slice(0, 3);
            return `
              <div style="background: #f8f9fa; border: 1px solid #e1e8ed; border-radius: 8px; padding: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                  <span style="font-weight: 700; text-transform: uppercase; color: #1da1f2; font-size: 1.1rem;">${ds.platform}</span>
                  <span style="background: #e1e8ed; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">#${ds.niche}</span>
                </div>
                <div style="font-size: 0.875rem; color: #555; margin-bottom: 0.5rem;">
                  <strong>Sample Size:</strong> ${ds.sampleSize} posts
                </div>
                <div style="font-size: 0.875rem; color: #555; margin-bottom: 0.5rem;">
                  <strong>Dominant Hook:</strong> ${topHooks[0] ? topHooks[0][0] : 'N/A'} (${topHooks[0] ? topHooks[0][1].viralRate : 0}%)
                </div>
                <div style="margin-top: 0.75rem;">
                  <strong style="font-size: 0.8rem; text-transform: uppercase; color: #888;">Top 3 Hooks:</strong>
                  <div style="margin-top: 0.4rem;">
                    ${topHooks.map(([hook, hdata]) => `
                      <div style="display: flex; justify-content: space-between; font-size: 0.8rem; padding: 0.2rem 0; border-bottom: 1px dashed #ddd;">
                        <span>${hook}</span>
                        <span style="font-weight: 600; color: #1da1f2;">${hdata.viralRate}% (n=${hdata.count})</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div style="background: #fff; border: 1px solid #e1e8ed; border-radius: 8px; padding: 1.25rem; margin-top: 1rem;">
        <h4 style="margin-bottom: 0.75rem;">Cross-Platform Strategy Insights:</h4>
        <ul style="padding-left: 1.25rem; font-size: 0.9rem; color: #444; line-height: 1.6;">
          <li><strong>Threads:</strong> Thống trị bởi hook <code>assertion</code> (tuyên bố trực diện, quan điểm cá nhân) kết hợp Call To Action cao.</li>
          <li><strong>Twitter / X:</strong> Đa dạng giữa <code>assertion</code>, <code>listicle</code>, và <code>contrarian</code>; nhạy cảm với số liệu và data-driven evidence.</li>
          <li><strong>Jev Decision Plane Verdict:</strong> Các bài viết có <code>curiosityGap > 0.7</code> và <code>specificityLevel >= 1.8</code> đạt tỷ lệ lan tỏa vượt trội trên cả hai nền tảng.</li>
        </ul>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color: red;">Failed to load comparison: ${err.message}</p>`;
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
