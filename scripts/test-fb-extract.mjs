import fs from 'node:fs';

function decodeFeedbackId(base64) {
  try {
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function walkJson(value, typeSet, results, visited) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, typeSet, results, visited);
  } else if (value && typeof value === 'object') {
    if (visited.has(value)) return;
    visited.add(value);
    if (typeof value.__typename === 'string' && typeSet.has(value.__typename)) {
      results.push(value);
    }
    for (const key of Object.keys(value)) {
      if (key === '__typename') continue;
      walkJson(value[key], typeSet, results, visited);
    }
  }
}

function extractPostFeedbackIdFromHtml(html) {
  if (typeof html !== 'string' || !html.includes('data-content-len')) return null;
  const re = /<script type="application\/json"[^>]*data-content-len="[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/script>/g;
  const typeSet = new Set(['Feedback']);

  let match;
  let count = 0;
  while ((match = re.exec(html)) !== null) {
    count++;
    try {
      const data = JSON.parse(match[1]);
      const feedbacks = [];
      walkJson(data, typeSet, feedbacks, new WeakSet());
      if (feedbacks.length) {
        console.log('script', count, 'feedbacks:', feedbacks.length);
      }
      for (const fb of feedbacks) {
        if (typeof fb.id !== 'string') continue;
        const decoded = decodeFeedbackId(fb.id);
        console.log('  fb.id decoded:', decoded);
        if (decoded && /^feedback:\d+$/.test(decoded)) {
          return fb.id;
        }
      }
    } catch (err) {
      // Invalid JSON or malformed script
    }
  }
  console.log('total scripts:', count);
  return null;
}

const html = fs.readFileSync('/tmp/fb-post.html', 'utf8');
console.log('feedbackId:', extractPostFeedbackIdFromHtml(html));
