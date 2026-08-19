import { describe, test, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import schemasRoutes from '../../api/routes/schemas.js';

const app = express();
app.use(express.json());
app.use('/api/schemas', schemasRoutes);

describe('Schemas API Routes', () => {
  test('GET /api/schemas should return list of registered schemas', async () => {
    const response = await request(app).get('/api/schemas');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.schemas)).toBe(true);
  });

  test('GET /api/schemas/:platform/:category should return schema definition', async () => {
    const response = await request(app).get('/api/schemas/twitter/social');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.schema).toBeDefined();
  });

  test('GET /api/schemas/:platform/:category should return 404 for unknown schema', async () => {
    const response = await request(app).get('/api/schemas/unknown/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('XACT_4041');
  });
});
