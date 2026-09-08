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
   * @param {Object} params
   * @param {string} [params.runId]
   * @param {string} params.scraperId
   * @param {string} params.platform
   * @param {string} params.category
   * @param {string} params.action
   * @param {'production' | 'canary'} [params.source]
   * @param {number} [params.startedAt]
   */
  constructor({
    runId = randomUUID(),
    scraperId = '',
    platform = '',
    category = 'social',
    action = '',
    source = 'production',
    startedAt = Date.now(),
  }) {
    this.runId = runId;
    this.scraperId = scraperId;
    this.platform = platform;
    this.category = category;
    this.action = action;
    this.source = source;
    this.startedAt = startedAt;

    /** @type {TransportRequestRecord[]} */
    this.requests = [];

    /** @type {StoreMetricsRecord | null} */
    this.storeMetrics = null;
  }

  /**
   * Factory method to create a new scoped context.
   * @param {Object} params
   * @returns {TelemetryContext}
   */
  static create(params) {
    return new TelemetryContext(params);
  }

  /**
   * Record an HTTP/CDP transport attempt.
   * @param {Object} req
   * @param {number} [req.latencyMs]
   * @param {number} [req.httpStatus]
   * @param {number} [req.proxyBytes]
   * @param {number} [req.retries]
   * @param {boolean} [req.isFalse200]
   * @param {boolean} [req.isCheckpoint]
   * @param {boolean} [req.proxyQuarantined]
   * @param {number} [req.ts]
   */
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
   * @param {Object} [runDetails]
   * @param {boolean} [runDetails.isSuccess]
   * @param {number} [runDetails.durationMs]
   * @param {number} [runDetails.itemCount]
   * @param {string | null} [runDetails.errorName]
   * @returns {Object}
   */
  toRunPayload(runDetails = {}) {
    const duration =
      runDetails.durationMs !== undefined
        ? Number(runDetails.durationMs)
        : Math.max(0, Date.now() - this.startedAt);

    return {
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
  }
}
