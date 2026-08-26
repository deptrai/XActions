# Story 11.6 — Rate-Limit & Bot-Challenge Defense (Quarantine, Retry, Hibernation)

**Story ID:** 11.6  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** done  
**Owner:** DEV  
**Source:** `epics.md` Story 11.6, `ARCHITECTURE-SPINE.md` AD-3 / AD-9 / AD-13, PRD FR-66 / NFR-13.

---

## Story

As a **Reliability Engineer**,  
I want **the system to automatically handle 429/403 and WAF/captcha by quarantining the proxy, retrying with a new proxy, and putting the account into hibernation**,  
so that **the system does not die in bulk when a platform activates protection**.

---

## Acceptance Criteria

### AC-1: Rate-limit handling

* **Given** the `AbstractApiClient` pipeline is running
* **When** `isRateLimit` returns true or HTTP 429/403 is received
* **Then** it throws `RateLimitError`, calls `proxyPool.quarantine(proxy)`, and retries up to 3 times with a new proxy and exponential backoff of 1s, 2s, 4s.

### AC-2: Bot-challenge / WAF / captcha handling

* **Given** the `AbstractApiClient` pipeline is running
* **When** `isBotChallenge` returns true or a WAF/captcha is detected
* **Then** it throws `BotChallengeError`, calls `proxyPool.quarantine(proxy, 5 minutes)`, calls `governor.hibernateAccount(accountId, 'bot_challenge', 15–30 minutes)`, calls `accountPool.markUnavailable(accountId)`, and switches to the next available account/proxy.

### AC-3: All-proxies quarantined

* **Given** all proxies are quarantined
* **When** a new request arrives
* **Then** the pipeline enters Standby Backoff 30s instead of looping forever.
