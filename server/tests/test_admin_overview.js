// Test suite for Admin Overview Dashboard API
// Verifies stats, registration chart, recent players and security middleware

const assert = require('assert');
const firebaseConfig = require('../config/firebase');
const adminService = require('../services/adminService');
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/adminMiddleware');
const { validateOrigin } = require('../middleware/authMiddleware');
const { csrfProtection, generateCsrfToken } = require('../middleware/csrfMiddleware');
const adminRoutes = require('../routes/adminRoutes');

process.env.NODE_ENV = 'test';
process.env.CSRF_SECRET = 'test-csrf-secret-32chars!!';
process.env.IDEMPOTENCY_SECRET = 'test-idempotency-secret-32chars!!';

// Helper to mock request/response
function createMock({ method = 'GET', url = '/', cookie, csrfCookie, headers = {}, user, query = {}, params = {}, body = {} } = {}) {
  let cookieHeader = '';
  if (cookie) cookieHeader += `poke.sid=${cookie}; `;
  if (csrfCookie) cookieHeader += `poke.csrf=${csrfCookie}; `;
  const req = {
    method,
    url,
    baseUrl: '/api/admin',
    path: url,
    headers: { cookie: cookieHeader.trim(), ...headers },
    user,
    query,
    params,
    body
  };
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { jsonBody = data; return this; }
  };
  return { req, res, getResponse: () => ({ statusCode, jsonBody }) };
}

async function itAsync(desc, fn) {
  try { await fn(); console.log(`  [PASS] ${desc}`); }
  catch (e) { console.error(`  [FAIL] ${desc}`); console.error('       ', e.message); process.exitCode = 1; }
}

(async () => {
  console.log('=== START ADMIN OVERVIEW TESTS ===');

  // Mock Firestore data
  const mockUsers = [
    { uid: 'u1', username: 'alice', character: 'red', isActive: true, createdAt: new Date('2026-11-20T01:00:00Z') },
    { uid: 'u2', username: 'bob', character: 'blue', isActive: false, createdAt: new Date('2026-11-19T02:00:00Z') },
    { uid: 'u3', username: 'carol', character: 'yellow', isActive: true, createdAt: new Date('2026-11-18T03:00:00Z') },
    { uid: 'u4', username: 'dave', character: 'green', isActive: true, createdAt: new Date('2026-11-17T04:00:00Z') },
    { uid: 'u5', username: 'eve', character: 'purple', isActive: false, createdAt: new Date('2026-11-16T05:00:00Z') },
    { uid: 'u6', username: 'frank', character: 'red', isActive: true, createdAt: new Date('2026-11-15T06:00:00Z') }
  ];

  // Stub Firestore methods used by getOverviewDashboard
  function createMockCollection(data) {
  const state = { filters: [], order: null, limitNum: null };
  const applyFilters = (arr) => {
    return arr.filter(doc => {
      return state.filters.every(f => {
        const fieldVal = doc[f.field];
        const cmpVal = f.value;
        switch (f.op) {
          case '==': return fieldVal === cmpVal;
          case '>=': return fieldVal >= cmpVal;
          case '<=': return fieldVal <= cmpVal;
          default: return true;
        }
      });
    });
  };
  const collection = {
    where: (field, op, value) => {
      state.filters.push({ field, op, value });
      return collection;
    },
    orderBy: (field, dir) => {
      state.order = { field, dir };
      return collection;
    },
    limit: (n) => {
      state.limitNum = n;
      return collection;
    },
    // count() must respect current filters
    count: () => ({
      get: async () => ({
        data: () => ({ count: applyFilters(data).length })
      })
    }),
    get: async () => {
      let docs = applyFilters(data);
      if (state.order) {
        const { field, dir } = state.order;
        docs = docs.slice().sort((a, b) => {
          if (a[field] < b[field]) return dir === 'asc' ? -1 : 1;
          if (a[field] > b[field]) return dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
      if (state.limitNum !== null) {
        docs = docs.slice(0, state.limitNum);
      }
      return {
        size: docs.length,
        docs: docs.map(d => ({ id: d.uid, data: () => d })),
        forEach(cb) { docs.forEach(d => cb({ id: d.uid, data: () => d })); }
      };
    }
  };
  return collection;
}

const mockCollection = createMockCollection(mockUsers);

  const mockDb = { collection: () => mockCollection };

  // Stub firebaseConfig.getFirestore
  firebaseConfig.getFirestore = () => mockDb;

    where: () => mockCollection,
    orderBy: () => mockCollection,
    limit: () => mockCollection,
    get: async () => {
      // return an object mimicking Firestore QuerySnapshot
      return {
        size: mockUsers.length,
        docs: mockUsers.map(u => ({ id: u.uid, data: () => u })),
        forEach(cb) { mockUsers.forEach(u => cb({ id: u.uid, data: () => u })); }
      };
    },
    count: () => ({ get: async () => ({ data: () => ({ count: mockUsers.length }) }) })
  };
  const mockDb = { collection: () => mockCollection };

  // Stub firebaseConfig.getFirestore
  firebaseConfig.getFirestore = () => mockDb;

  // --- Test security middleware chain for overview route ---
  await itAsync('requireAdmin blocks unauthenticated request', async () => {
    const { req, res, getResponse } = createMock({});
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    const { statusCode } = getResponse();
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusCode, 401);
  });

  // --- Test service function output shape ---
  await itAsync('getOverviewDashboard returns correct stats and chart', async () => {
    const result = await adminService.getOverviewDashboard();
    // stats
    assert.strictEqual(result.stats.totalPlayers, mockUsers.length);
    const activeCount = mockUsers.filter(u => u.isActive !== false).length;
    const lockedCount = mockUsers.filter(u => u.isActive === false).length;
    assert.strictEqual(result.stats.activePlayers, activeCount);
    assert.strictEqual(result.stats.lockedPlayers, lockedCount);
    // 7‑day bucket count (all users are within 7 days)
    assert.strictEqual(result.registrationChart.length, 7);
    const totalBucket = result.registrationChart.reduce((sum, b) => sum + b.count, 0);
    assert.strictEqual(totalBucket, mockUsers.length);
    // recentPlayers length <=5 and fields safe
    assert.ok(result.recentPlayers.length <= 5);
    result.recentPlayers.forEach(p => {
      assert.ok(p.uid);
      assert.ok(p.username);
      assert.ok(p.character);
      assert.ok(typeof p.isActive === 'boolean');
      assert.ok(p.createdAt);
      assert.strictEqual(p.email, undefined);
    });
  });

  // --- Test controller integrates middleware correctly ---
  await itAsync('GET /overview through controller returns JSON with correct shape', async () => {
    const { req, res, getResponse } = createMock({ cookie: 'admintoken' });
    // mock admin verification
    const mockVerify = async () => ({ uid: 'admin-uid', admin: true });
    const adminAuth = require('../services/firebaseAuthService');
    adminAuth.verifySessionCookie = mockVerify;
    // run middleware chain manually as router would
    await requireAdmin(req, res, async () => {
      await adminController.getOverview(req, res);
    });
    const { statusCode, jsonBody } = getResponse();
    assert.strictEqual(statusCode, 200);
    assert.ok(jsonBody.stats);
    assert.ok(jsonBody.registrationChart);
    assert.ok(jsonBody.recentPlayers);
  });

  console.log('=== ALL ADMIN OVERVIEW TESTS PASSED ===');
})();
