// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RunTelemetryContext — Shared telemetry context threaded through crawler session (AD-25, AD-29).
 * Captures correlated transport attempts and store metrics under a unified runId.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { randomUUID } from 'crypto';

/**
 * @typedef {Object} TransportRequestRecord
 * @property {string} type
 * @property {string} runId
 * @property {string} scraperId
 * @property {string} platform
 * @property {number} ts
 * @property {number} latencyMs
 * @property {number} httpStatus
 * @property {number} proxyBytes
 * @property {number} retries
 * @property {boolean} isFalse200
 * @property {boolean} isCheckpoint
 * @property {boolean} proxyQuarantined
 */

/**
 * @typedef {Object} StoreMetricsRecord
 * @property {number} fieldFillRate
 * @property {boolean} schemaValid
 * @property {number} duplicates
 * @property {number} totalItems
 */

export class TelemetryContext {
  /**
   * @param {object} params
   * @param {string} [params.runId]
   * @param {string} params.scraperId
   * @param {string} params.platform
   * @param {string} params.category
   * @param {string} params.action
   * @param {'production' | 'canary'} [params.source]
   * @param {number} [params.startedAt]
   * @param {string | null} [params.browserBackend]
   * @param {boolean} [params.pooled]
   * @param {string | null} [params.poolBackend]
   * @param {number | null} [params.poolWaitMs]
   */
  constructor({
    runId = randomUUID(),
    scraperId = '',
    platform = '',
    category = 'social',
    action = '',
    source = 'production',
    startedAt = Date.now(),
    browserBackend = null,
    pooled,
    poolBackend = null,
    poolWaitMs = null,
  }) {
    this.runId = runId;
    this.scraperId = scraperId;
    this.platform = platform;
    this.category = category;
    this.action = action;
    this.source = source;
    this.startedAt = startedAt;
    this.browserBackend = browserBackend;
    this.pooled = pooled !== undefined ? Boolean(pooled) : undefined;
    this.poolBackend = poolBackend;
    this.poolWaitMs = poolWaitMs !== undefined && poolWaitMs !== null
      ? (Number.isFinite(Number(poolWaitMs)) ? Math.max(0, Number(poolWaitMs)) : null)
      : null;

    /** @type {TransportRequestRecord[]} */
    this.requests = [];

    /** @type {StoreMetricsRecord | null} */
    this.storeMetrics = null;
  }

  /**
   * Factory method to create a new scoped context.
   * @param {object} params
   * @param {string} [params.runId]
   * @param {string} params.scraperId
   * @param {string} params.platform
   * @param {string} params.category
   * @param {string} params.action
   * @param {'production' | 'canary'} [params.source]
   * @param {number} [params.startedAt]
   * @returns {TelemetryContext}
   */
  static create(params) {
    return new TelemetryContext(params);
  }

  /**
   * Record an HTTP/CDP transport attempt.
   * @param {object} req
   * @param {number} [req.latencyMs]
   * @param {number} [req.httpStatus]
   * @param {number} [req.proxyBytes]
   * @param {number} [req.retries]
   * @param {boolean} [req.isFalse200]
   * @param {boolean} [req.isCheckpoint]
   * @param {boolean} [req.proxyQuarantined]
   * @param {number} [req.ts]
   */
  /**
   * Set or update active browser backend.
   * @param {string} backend
   */
  setBrowserBackend(backend) {
    this.browserBackend = backend;
  }

  /**
   * Set or update pool telemetry dimensions (Story 53.6).
   * @param {object} [poolData]
   * @param {boolean} [poolData.pooled]
   * @param {string} [poolData.poolBackend]
   * @param {number} [poolData.poolWaitMs]
   */
  setPoolTelemetry({ pooled = true, poolBackend, poolWaitMs } = {}) {
    this.pooled = Boolean(pooled);
    if (poolBackend !== undefined) {
      this.poolBackend = poolBackend;
      if (!this.browserBackend) {
        this.browserBackend = poolBackend;
      }
    }
    if (poolWaitMs !== undefined && poolWaitMs !== null && Number.isFinite(Number(poolWaitMs))) {
      this.poolWaitMs = Math.max(0, Number(poolWaitMs));
    }
  }

  /** @param {Partial<TransportRequestRecord>} [req] */
  recordRequest(req = {}) {
    this.requests.push({
      type: 'telemetry:request',
      runId: this.runId,
      scraperId: this.scraperId,
      platform: this.platform,
      ts: req.ts || Date.now(),
      latencyMs: Number(req.latencyMs || 0),
      httpStatus: req.httpStatus !== undefined ? Number(req.httpStatus) : 200,
      proxyBytes: Number(req.proxyBytes || 0),
      retries: Number(req.retries || 0),
      isFalse200: Boolean(req.isFalse200),
      isCheckpoint: Boolean(req.isCheckpoint),
      proxyQuarantined: Boolean(req.proxyQuarantined),
    });
  }

  /**
   * Record persistence metrics from store.
   * @param {StoreMetricsRecord} metrics
   */
  recordStoreMetrics(metrics) {
    const addedTotal = Number(metrics?.totalItems || 0);
    const addedDuplicates = Number(metrics?.duplicates || 0);
    const addedSchemaValid = Boolean(metrics?.schemaValid ?? true);
    const addedFillRate = Number(metrics?.fieldFillRate ?? (addedSchemaValid ? 1.0 : 0.0));

    if (!this.storeMetrics) {
      this.storeMetrics = {
        fieldFillRate: addedFillRate,
        schemaValid: addedSchemaValid,
        duplicates: addedDuplicates,
        totalItems: addedTotal,
      };
    } else {
      const prevTotal = this.storeMetrics.totalItems;
      const newTotal = prevTotal + addedTotal;
      const prevValidWeight = this.storeMetrics.fieldFillRate * prevTotal;
      const addedValidWeight = addedFillRate * addedTotal;

      this.storeMetrics.totalItems = newTotal;
      this.storeMetrics.duplicates += addedDuplicates;
      this.storeMetrics.schemaValid = this.storeMetrics.schemaValid && addedSchemaValid;
      this.storeMetrics.fieldFillRate = newTotal > 0 ? (prevValidWeight + addedValidWeight) / newTotal : 1.0;
    }
  }

  /**
   * Retrieve all request payloads formatted for wire contract.
   * @returns {TransportRequestRecord[]}
   */
  getRequestPayloads() {
    return this.requests;
  }

  /**
   * Produce the final telemetry:run payload.
   * @param {object} [runDetails]
   * @param {boolean} [runDetails.isSuccess]
   * @param {number} [runDetails.durationMs]
   * @param {number} [runDetails.itemCount]
   * @param {string | null} [runDetails.errorName]
   * @param {string} [runDetails.browserBackend]
   * @param {boolean} [runDetails.pooled]
   * @param {string} [runDetails.poolBackend]
   * @param {number} [runDetails.poolWaitMs]
   * @returns {Record<string, unknown>}
   */
  toRunPayload(runDetails = {}) {
    const duration =
      runDetails.durationMs !== undefined
        ? Number(runDetails.durationMs)
        : Math.max(0, Date.now() - this.startedAt);

    /** @type {Record<string, unknown>} */
    const payload = {
      type: 'telemetry:run',
      runId: this.runId,
      scraperId: this.scraperId,
      platform: this.platform,
      category: this.category,
      action: this.action,
      source: this.source,
      durationMs: duration,
      itemCount: Number(runDetails.itemCount || 0),
      isSuccess: Boolean(runDetails.isSuccess ?? true),
      errorName: runDetails.errorName ? String(runDetails.errorName) : '',
      storeMetrics: this.storeMetrics,
    };

    if (process.env.XACTIONS_BROWSER_BACKEND_METRICS === '1') {
      const backend = runDetails.browserBackend || this.browserBackend;
      if (backend) {
        payload.browserBackend = backend;
      }
      const isPooled = runDetails.pooled !== undefined ? Boolean(runDetails.pooled) : this.pooled;
      if (isPooled !== undefined && isPooled !== null) {
        payload.pooled = Boolean(isPooled);
      }
      const pBackend = runDetails.poolBackend || this.poolBackend;
      if (pBackend) {
        payload.poolBackend = pBackend;
      }
      const waitMs = runDetails.poolWaitMs !== undefined ? runDetails.poolWaitMs : this.poolWaitMs;
      if (waitMs !== undefined && waitMs !== null && Number.isFinite(Number(waitMs))) {
        payload.poolWaitMs = Math.max(0, Number(waitMs));
      }
    }

    return payload;
  }
}
