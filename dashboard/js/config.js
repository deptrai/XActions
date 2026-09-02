/**
 * XActions Dashboard Configuration
 * 
 * This file provides API configuration for all dashboard pages.
 * Include this file in any page that makes API calls.
 */

const CONFIG = {
  // API Base URL - auto-detects environment
  API_BASE: `${window.location.origin}/api`,

  // WebSocket URL for real-time updates
  WS_URL: window.location.origin,

  // App version
  VERSION: '1.0.0',
  
  // Default rate limiting delays (ms)
  DELAYS: {
    MIN: 1500,
    MAX: 3000,
    BETWEEN_REQUESTS: 2000
  },
  
  // Pagination defaults
  PAGINATION: {
    DEFAULT_LIMIT: 100,
    MAX_LIMIT: 1000
  }
};

/**
 * Make an authenticated API request
 * @param {string} endpoint - API endpoint (e.g., '/user/profile')
 * @param {object} options - Fetch options
 * @returns {Promise<object>} - Response data
 */
async function apiRequest(endpoint, options = {}) {
  const authToken = localStorage.getItem('authToken');
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken && { 'Authorization': `Bearer ${authToken}` })
    }
  };
  
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {})
    }
  };
  
  const url = endpoint.startsWith('http') 
    ? endpoint 
    : `${CONFIG.API_BASE}${endpoint}`;
  
  const response = await fetch(url, mergedOptions);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Request failed');
  }
  
  return data;
}

/**
 * Make an AI API request (for server-side automation)
 * @param {string} endpoint - AI API endpoint
 * @param {object} body - Request body
 * @returns {Promise<object>} - Response data
 */
async function aiApiRequest(endpoint, body = {}) {
  return apiRequest(`/ai${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * Poll operation status
 * @param {string} operationId - The operation ID to poll
 * @param {function} onProgress - Callback for progress updates
 * @param {function} onComplete - Callback when complete
 * @param {function} onError - Callback on error
 */
async function pollOperationStatus(operationId, onProgress, onComplete, onError) {
  const poll = async () => {
    try {
      const data = await apiRequest(`/ai/action/status/${operationId}`);
      
      if (onProgress && data.progress) {
        onProgress(data.progress);
      }
      
      if (data.status === 'completed') {
        if (onComplete) onComplete(data);
        return;
      }
      
      if (data.status === 'failed') {
        if (onError) onError(data.error || 'Operation failed');
        return;
      }
      
      // Continue polling
      setTimeout(poll, 2000);
    } catch (error) {
      if (onError) onError(error.message);
    }
  };
  
  poll();
}

/**
 * Format numbers for display (e.g., 1500 -> 1.5K)
 */
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format time ago (e.g., "5 minutes ago")
 */
function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const seconds = Math.floor((new Date() - date) / 1000);
  
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60
  };
  
  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
    }
  }
  
  return 'just now';
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
  return !!localStorage.getItem('authToken');
}

/**
 * Redirect to login if not authenticated
 */
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/login';
    return false;
  }
  return true;
}

/**
 * Show a modern toast notification (unified system)
 * @param {string} message - Message text
 * @param {'success'|'error'|'warning'|'info'} [type='info'] - Type
 * @param {number} [duration=3500] - Duration in ms
 */
function showToast(message, type = 'info', duration = 3500) {
  let container = document.querySelector('.xa-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'xa-toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: '⚡'
  };

  const toast = document.createElement('div');
  toast.className = `xa-toast xa-toast--${type}`;
  toast.role = type === 'error' ? 'alert' : 'status';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'xa-toast-icon';
  iconSpan.textContent = icons[type] || icons.info;
  iconSpan.setAttribute('aria-hidden', 'true');

  const msgSpan = document.createElement('span');
  msgSpan.className = 'xa-toast-msg';
  msgSpan.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'xa-toast-close';
  closeBtn.setAttribute('aria-label', 'Close notification');
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => dismiss();

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  let timer = setTimeout(dismiss, duration);

  function dismiss() {
    clearTimeout(timer);
    toast.classList.add('xa-toast-hiding');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 260);
  }
}

// Global helpers on window
if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.copyToClipboard = async function (text, successMsg = 'Copied to clipboard!') {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMsg, 'success');
      return true;
    } catch {
      showToast('Failed to copy', 'error');
      return false;
    }
  };
}

// Export for module usage (if using modules)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, apiRequest, aiApiRequest, pollOperationStatus, formatNumber, formatDate, timeAgo, isAuthenticated, requireAuth, showToast };
}
