// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Swagger UI mount helper — Story 46.1.
 *
 * Single owner for the `swagger-ui-express` mount shared by `api/server.js`
 * (primary Node/Express deployment) and `api/serverless.js` (Vercel). The
 * two surfaces cannot drift because the options and the per-operation
 * Try-It-Out gate live here.
 *
 * The OpenAPI document is the single source of truth — this layer only
 * renders it. Spec generation is lazy: `specThunk` is invoked on every
 * `/api-docs` request and `swagger-ui-express` reads it via `req.swaggerDoc`,
 * so a throwing `generateSpec()` degrades to a 500 envelope via
 * `errorMiddleware` instead of crashing the process at module load — and
 * the UI stays in lock-step with `GET /openapi.json` (which already
 * regenerates per request).
 *
 * Try-It-Out policy:
 *   - Global baseline: `supportedSubmitMethods: ['get']` — POST/PUT/DELETE/
 *     PATCH ops render their schemas but never execute from the UI.
 *   - Per-operation granularity: the `x-tryitout` vendor extension. Ops
 *     marked `x-tryitout: false` (x402-paid endpoints, real-account
 *     mutations, and any future GET that is actually a state mutation) have
 *     their Execute button disabled by the `allowTryItOutFor` wrap selector
 *     below.
 *
 * @module api/openapi-swagger
 */

import swaggerUi from 'swagger-ui-express';

/**
 * swagger-ui wrapSelector — gates the per-operation Try-It-Out allowance.
 * Returns `false` when the operation carries `x-tryitout: false`; otherwise
 * delegates to the original `allowTryItOutFor` selector (which honours
 * `supportedSubmitMethods`).
 */
const gateTryItOut = (oriSelector, system) => (path, method) => {
  const op = system.getSystem().specSelectors.spec().getIn(['paths', path, method]);
  if (op?.get('x-tryitout') === false) return false;
  return oriSelector(path, method);
};

/**
 * Shared swagger-ui options — identical on server.js and serverless.js.
 */
export const swaggerOptions = {
  supportedSubmitMethods: ['get'],
  tryItOutEnabled: true,
  plugins: [
    {
      statePlugins: {
        spec: {
          wrapSelectors: {
            allowTryItOutFor: gateTryItOut,
          },
        },
      },
    },
  ],
};

/**
 * Mount self-hosted Swagger UI at `/api-docs` on the given Express app.
 *
 * `specThunk` is invoked on every `/api-docs` request — keeping the UI in
 * sync with `GET /openapi.json` (which regenerates per request) and turning
 * a throwing `generateSpec()` into a request-scoped 500 envelope through
 * `errorMiddleware` instead of a boot-time crash.
 *
 * Mount BEFORE any `/docs/:slug` handlers and AFTER `/openapi.json` so the
 * spec endpoint resolves first.
 *
 * @param {import('express').Express} app
 * @param {() => Record<string, unknown>} specThunk
 */
export function mountSwaggerUi(app, specThunk) {
  const resolveDoc = (req, res, next) => {
    try {
      req.swaggerDoc = specThunk();
      next();
    } catch (err) {
      next(err);
    }
  };
  app.use('/api-docs', swaggerUi.serve, resolveDoc, swaggerUi.setup(null, { swaggerOptions }));
}
