// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalization utilities for LinkedIn Recruitment & B2B Lead data
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { stripHtml } from '../topcv/normalize-job.js';

const SKILL_KEYWORDS = [
  'Python', 'FastAPI', 'Django', 'Flask', 'Go', 'Golang', 'Java', 'Spring Boot',
  'C++', 'C#', '.NET', 'Rust', 'Node.js', 'TypeScript', 'JavaScript', 'React',
  'Next.js', 'Vue', 'Angular', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis',
  'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Terraform', 'CI/CD',
  'GraphQL', 'REST API', 'Microservices', 'System Design', 'Agile', 'Scrum',
];

/**
 * Extract matched skills from text content using strict word boundaries.
 * @param {string} text
 * @returns {string[]}
 */
export function extractSkills(text) {
  if (!text || typeof text !== 'string') return [];
  const found = [];
  for (const skill of SKILL_KEYWORDS) {
    const escaped = skill.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
    if (regex.test(text)) {
      found.push(skill);
    }
  }
  return [...new Set(found)];
}

/**
 * Parse single LinkedIn job card HTML into PostItem.
 * @param {string} chunk
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function parseLinkedInJobCard(chunk) {
  if (!chunk || typeof chunk !== 'string') return null;

  const urnMatch = chunk.match(/urn:li:jobPosting:(\d+)/i) || chunk.match(/data-entity-urn="[^"]*?:(\d+)"/i);
  const urlMatch = chunk.match(/href="([^"]*?jobs\/view\/[^"]*?)"/i) || chunk.match(/<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]*)"/i);

  const rawUrl = urlMatch ? urlMatch[1] : '';
  const jobId = urnMatch ? urnMatch[1] : (rawUrl.match(/\/(\d{8,14})/)?.[1] || 'unknown');

  const titleMatch = chunk.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i) ||
                     chunk.match(/<span[^>]*class="sr-only"[^>]*>([\s\S]*?)<\/span>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : '';

  const companyMatch = chunk.match(/<a[^>]*class="[^"]*(?:hidden-nested-link|base-search-card__subtitle)[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
                       chunk.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
  const companyName = companyMatch ? stripHtml(companyMatch[1]) : '';

  const locMatch = chunk.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const location = locMatch ? stripHtml(locMatch[1]) : '';

  const dateMatch = chunk.match(/<time[^>]*datetime="([^"]*)"[^>]*>([\s\S]*?)<\/time>/i);
  let postedAt = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

  let publishedAtIso;
  try {
    const parsed = new Date(postedAt);
    publishedAtIso = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  } catch {
    publishedAtIso = new Date().toISOString();
  }

  return {
    id: `linkedin:job:${jobId}`,
    platform: 'linkedin',
    externalId: jobId,
    category: 'recruitment',
    authorId: `linkedin:company:${encodeURIComponent(companyName || 'unknown')}`,
    authorName: companyName,
    postUrl: rawUrl || `https://www.linkedin.com/jobs/view/${jobId}`,
    content: `${title}\n\nCompany: ${companyName}\nLocation: ${location}`.trim(),
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: publishedAtIso,
    crawledAt: new Date(),
    metadata: {
      jobId,
      title,
      companyName,
      location,
      postedAt,
      sourceMethod: 'search_jobs',
    },
  };
}

/**
 * Parse LinkedIn job detail HTML into PostItem.
 * @param {string} html
 * @param {string} jobId
 * @returns {import('../../../core/types.js').PostItem}
 */
export function parseLinkedInJobDetail(html, jobId) {
  const titleMatch = html.match(/<h1[^>]*class="[^"]*top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
                     html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : '';

  const companyMatch = html.match(/<a[^>]*class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  const companyName = companyMatch ? stripHtml(companyMatch[1]) : '';

  const locMatch = html.match(/<span[^>]*class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const location = locMatch ? stripHtml(locMatch[1]) : '';

  const descMatch = html.match(/<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const description = descMatch ? stripHtml(descMatch[1]) : '';

  let employmentType = null;
  const empMatch = html.match(/Employment type[\s\S]*?<span[^>]*class="[^"]*criteria[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  if (empMatch) {
    const rawEmp = stripHtml(empMatch[1]).toLowerCase();
    if (rawEmp.includes('full-time') || rawEmp.includes('full time')) employmentType = 'full_time';
    else if (rawEmp.includes('part-time') || rawEmp.includes('part time')) employmentType = 'part_time';
    else if (rawEmp.includes('contract')) employmentType = 'contract';
    else if (rawEmp.includes('intern')) employmentType = 'intern';
  }

  let seniorityLevel = null;
  const senMatch = html.match(/Seniority level[\s\S]*?<span[^>]*class="[^"]*criteria[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  if (senMatch) {
    seniorityLevel = stripHtml(senMatch[1]);
  }

  const skills = extractSkills(`${title} ${description}`);

  return {
    id: `linkedin:job:${jobId}`,
    platform: 'linkedin',
    externalId: jobId,
    category: 'recruitment',
    authorId: `linkedin:company:${encodeURIComponent(companyName || 'unknown')}`,
    authorName: companyName,
    postUrl: `https://www.linkedin.com/jobs/view/${jobId}`,
    content: `${title}\n\nCompany: ${companyName}\nLocation: ${location}\n\n${description}`.trim(),
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: new Date().toISOString(),
    crawledAt: new Date(),
    metadata: {
      jobId,
      title,
      companyName,
      location,
      description,
      employmentType,
      seniorityLevel,
      skills,
      sourceMethod: 'job_detail',
    },
  };
}

/**
 * Normalize LinkedIn company into ProfileItem.
 * @param {Record<string, any>} company
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeLinkedInCompany(company = {}) {
  const companySlug = String(company.companySlug || company.id || 'unknown').trim();
  const name = String(company.companyName || company.name || companySlug).trim();

  return {
    id: `linkedin:company:${companySlug}`,
    platform: 'linkedin',
    externalId: companySlug,
    name,
    username: companySlug,
    profileUrl: company.companyUrl || `https://www.linkedin.com/company/${companySlug}`,
    bio: company.description || company.industry || undefined,
    followersCount: Number(company.followersCount) || 0,
    followingCount: 0,
    crawledAt: new Date(),
    metadata: {
      companySlug,
      name,
      industry: company.industry || undefined,
      scale: company.scale || undefined,
      website: company.website || undefined,
      location: company.location || undefined,
      sourceMethod: 'company_profile',
    },
  };
}

/**
 * Normalize LinkedIn B2B lead into ProfileItem.
 * @param {Record<string, any>} lead
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeLinkedInLead(lead = {}) {
  const profileSlug = String(lead.profileSlug || lead.id || 'unknown').trim();
  const name = String(lead.name || profileSlug).trim();
  const headline = String(lead.headline || lead.title || lead.bio || '').trim();

  return {
    id: `linkedin:lead:${profileSlug}`,
    platform: 'linkedin',
    externalId: profileSlug,
    name,
    username: profileSlug,
    bio: headline || undefined,
    profileUrl: lead.profileUrl || `https://www.linkedin.com/in/${profileSlug}`,
    followersCount: Number(lead.connectionsCount) || 0,
    followingCount: 0,
    crawledAt: new Date(),
    metadata: {
      profileSlug,
      name,
      headline,
      title: lead.title || headline || undefined,
      companyName: lead.companyName || undefined,
      location: lead.location || undefined,
      sourceMethod: 'lead_profile',
    },
  };
}
