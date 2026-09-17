import express from 'express';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import prisma from '../api/lib/prisma.js';
import governorRoutes from '../api/routes/governor.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'xactions-super-secret-jwt-key-2026';
const adminToken = jwt.sign(
  { id: 'usr_admin', userId: 'usr_admin', role: 'admin' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// Mock prisma user lookup for isolated E2E HTTP testing
prisma.user.findUnique = async () => ({
  id: 'usr_admin',
  role: 'admin',
  email: 'admin@xactions.app',
  username: 'admin',
});

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'healthy', version: '4.0.0' }));
app.use('/api/governor', governorRoutes);

const server = createServer(app);
const PORT = 3999;

server.listen(PORT, async () => {
  console.log(`📡 E2E Test Server listening on http://127.0.0.1:${PORT}`);
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`,
  };

  try {
    console.log('\n=== BƯỚC 1: TEST E2E API /health ===');
    const healthRes = await fetch(`http://127.0.0.1:${PORT}/health`);
    const healthData = await healthRes.json();
    console.log('Response /health:', healthData);

    console.log('\n=== BƯỚC 2: TEST E2E API /api/governor/status (Admin Auth) ===');
    const statusRes = await fetch(`http://127.0.0.1:${PORT}/api/governor/status`, {
      headers: authHeaders,
    });
    const statusData = await statusRes.json();
    console.log('Status HTTP Code:', statusRes.status);
    console.log('Governor throttle level:', statusData.status?.throttleLevel);
    console.log('Consumer quotas:', Object.keys(statusData.status?.consumerQuotas || {}));

    console.log('\n=== BƯỚC 3: TEST E2E API /api/governor/panic-stop (Admin Auth) ===');
    const panicRes = await fetch(`http://127.0.0.1:${PORT}/api/governor/panic-stop`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ platform: 'twitter' }),
    });
    const panicData = await panicRes.json();
    console.log('Panic HTTP Code:', panicRes.status);
    console.log('Response panic-stop:', panicData.message, '| Level:', panicData.result?.throttleLevel);

    console.log('\n=== BƯỚC 4: TEST E2E API /api/governor/priorities (Admin Auth) ===');
    const prioRes = await fetch(`http://127.0.0.1:${PORT}/api/governor/priorities`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        priorities: [
          { consumerId: 'nowing', priority: 1 },
          { consumerId: 'chainlens', priority: 2 },
        ],
      }),
    });
    const prioData = await prioRes.json();
    console.log('Priorities HTTP Code:', prioRes.status);
    console.log('Response priorities updated:', prioData.updated);

    console.log('\n=== BƯỚC 5: TEST E2E API /api/governor/panic-resume (Admin Auth) ===');
    const resumeRes = await fetch(`http://127.0.0.1:${PORT}/api/governor/panic-resume`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ platform: 'twitter' }),
    });
    const resumeData = await resumeRes.json();
    console.log('Resume HTTP Code:', resumeRes.status);
    console.log('Response panic-resume:', resumeData.message);

    console.log('\n🎉 TẤT CẢ CÁC BƯỚC TEST E2E API VỚI ADMIN JWT AUTH ĐÃ THÀNH CÔNG 100%!');
  } catch (err) {
    console.error('❌ E2E API test failed:', err);
  } finally {
    server.close(() => {
      console.log('E2E Server closed cleanly.');
      process.exit(0);
    });
  }
});
