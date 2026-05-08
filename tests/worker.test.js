import worker from '../src/worker.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de prueba
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un Request de prueba con el método, path, headers y body indicados.
 */
function makeRequest(method, path, { body, token, headers = {} } = {}) {
  const url = `https://dressflow.pages.dev${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://dressflow.pages.dev',
      ...headers,
    },
  };

  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  opts.body = JSON.stringify(body);

  return new Request(url, opts);
}

/**
 * Construye el objeto env de prueba.
 * El binding DB es un mock de D1 con métodos prepare/bind/run/first/all.
 */
function makeEnv(dbOverrides = {}) {
  const defaultDb = {
    prepare: jest.fn().mockReturnValue({
      bind: jest.fn().mockReturnThis(),
      run:  jest.fn().mockResolvedValue({ success: true }),
      first: jest.fn().mockResolvedValue(null),
      all:  jest.fn().mockResolvedValue({ results: [] }),
    }),
  };

  return {
    DB:              { ...defaultDb, ...dbOverrides },
    JWT_SECRET:      'test-secret-for-unit-tests-only',
    JWT_EXPIRY_SECONDS: '3600',
    ALLOWED_ORIGINS: 'https://dressflow.pages.dev',
    TAX_RATE:        '0.16',
    APP_ENV:         'test',
  };
}

/**
 * Genera un JWT válido de prueba para el usuario indicado.
 * Llama directamente al Web Crypto API (disponible en el entorno de prueba).
 */
async function generateTestToken(user = {}, secret = 'test-secret-for-unit-tests-only') {
  const strToBuffer  = str => new TextEncoder().encode(str);
  const bufToBase64url = buf =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const key = await crypto.subtle.importKey(
    'raw', strToBuffer(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const header  = bufToBase64url(strToBuffer(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = bufToBase64url(strToBuffer(JSON.stringify({
    sub:   user.id   || 'usr_test001',
    role:  user.role || 'Admin',
    name:  user.name || 'Test Admin',
    email: user.email || 'admin@test.com',
    iat:   Math.floor(Date.now() / 1000),
    exp:   Math.floor(Date.now() / 1000) + 3600,
  })));

  const sig = bufToBase64url(
    await crypto.subtle.sign('HMAC', key, strToBuffer(`${header}.${payload}`))
  );

  return `${header}.${payload}.${sig}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Respuestas HTTP y CORS
// ─────────────────────────────────────────────────────────────────────────────

describe('HTTP Responses', () => {

  test('OPTIONS (preflight) responde 204 sin body', async () => {
    const req = new Request('https://dressflow.pages.dev/api/products', {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://dressflow.pages.dev' },
    });

    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(204);
  });

  test('Ruta inexistente devuelve 404', async () => {
    const token = await generateTestToken();
    const req   = makeRequest('GET', '/api/nonexistent', { token });
    const res   = await worker.fetch(req, makeEnv(), {});

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe(true);
  });

  test('Headers CORS presentes en todas las respuestas', async () => {
    const req = makeRequest('GET', '/api/nonexistent');
    const res = await worker.fetch(req, makeEnv(), {});

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  test('Sin DB binding devuelve 503', async () => {
    const req = makeRequest('GET', '/api/products');
    const env = makeEnv();
    delete env.DB;

    const res = await worker.fetch(req, env, {});
    expect(res.status).toBe(503);
  });

  test('Sin JWT_SECRET devuelve 503', async () => {
    const req = makeRequest('GET', '/api/products');
    const env = makeEnv();
    delete env.JWT_SECRET;

    const res = await worker.fetch(req, env, {});
    expect(res.status).toBe(503);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Autenticación
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {

  test('Devuelve 400 si faltan campos', async () => {
    const req = makeRequest('POST', '/api/auth/login', { body: { email: 'a@b.com' } });
    const res = await worker.fetch(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/requeridos/i);
  });

  test('Devuelve 401 si el usuario no existe en D1', async () => {
    const dbMock = {
      prepare: jest.fn().mockReturnValue({
        bind:  jest.fn().mockReturnThis(),
        all:   jest.fn().mockResolvedValue({ results: [] }), // sin usuario
        first: jest.fn().mockResolvedValue(null),
        run:   jest.fn().mockResolvedValue({ success: true }),
      }),
    };

    const req = makeRequest('POST', '/api/auth/login', {
      body: { email: 'noexiste@test.com', password: 'cualquiera' },
    });
    const res = await worker.fetch(req, makeEnv(dbMock), {});

    expect(res.status).toBe(401);
  });

  test('Devuelve 401 si el usuario está inactivo', async () => {
    const dbMock = {
      prepare: jest.fn().mockReturnValue({
        bind:  jest.fn().mockReturnThis(),
        all:   jest.fn().mockResolvedValue({
          results: [{ id: 'u1', email: 'a@b.com', password_hash: 'x', name: 'A', role: 'Admin', is_active: 0 }]
        }),
        first: jest.fn().mockResolvedValue(null),
        run:   jest.fn().mockResolvedValue({ success: true }),
      }),
    };

    const req = makeRequest('POST', '/api/auth/login', {
      body: { email: 'a@b.com', password: '123456' },
    });
    const res = await worker.fetch(req, makeEnv(dbMock), {});
    expect(res.status).toBe(401);
  });

  test('Devuelve 400 si el body no es JSON válido', async () => {
    const req = new Request('https://dressflow.pages.dev/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'esto-no-es-json',
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Middleware de autorización RBAC
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC Middleware', () => {

  test('Sin token devuelve 401', async () => {
    const req = makeRequest('GET', '/api/products'); // sin token
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(401);
  });

  test('Token malformado devuelve 401', async () => {
    const req = makeRequest('GET', '/api/products', { token: 'esto.no.esjwt' });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(401);
  });

  test('Rol Ventas no puede acceder a /api/users', async () => {
    const token = await generateTestToken({ role: 'Ventas' });
    const req   = makeRequest('GET', '/api/users', { token });
    const res   = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.message).toMatch(/Ventas/);
  });

  test('Rol Gerente no puede acceder a /api/users', async () => {
    const token = await generateTestToken({ role: 'Gerente' });
    const req   = makeRequest('GET', '/api/users', { token });
    const res   = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(403);
  });

  test('Rol Admin puede acceder a /api/users', async () => {
    const token = await generateTestToken({ role: 'Admin' });
    const req   = makeRequest('GET', '/api/users', { token });
    const env   = makeEnv(); // DB mock devuelve []
    const res   = await worker.fetch(req, env, {});
    expect(res.status).toBe(200);
  });

  test('Rol Ventas no puede crear productos (POST /api/products)', async () => {
    const token = await generateTestToken({ role: 'Ventas' });
    const req   = makeRequest('POST', '/api/products', {
      token,
      body: { sku: 'X', name: 'Y', category_id: 'c1', price: 100, cost: 50, stock: 1 },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(403);
  });

  test('Rol Ventas no puede eliminar productos (DELETE /api/products/:id)', async () => {
    const token = await generateTestToken({ role: 'Ventas' });
    const req   = makeRequest('DELETE', '/api/products/prd_001', { token });
    const res   = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(403);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Productos
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/products', () => {

  test('Devuelve lista de productos para rol Admin', async () => {
    const token = await generateTestToken({ role: 'Admin' });
    const mockProducts = [
      { id: 'p1', sku: 'DRS-001', name: 'Test Dress', price: 1000, stock: 5, is_active: 1 },
    ];

    const dbMock = {
      prepare: jest.fn().mockReturnValue({
        bind:  jest.fn().mockReturnThis(),
        all:   jest.fn().mockResolvedValue({ results: mockProducts }),
        first: jest.fn().mockResolvedValue(null),
        run:   jest.fn().mockResolvedValue({ success: true }),
      }),
    };

    const req = makeRequest('GET', '/api/products', { token });
    const res = await worker.fetch(req, makeEnv(dbMock), {});

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.products).toHaveLength(1);
    expect(data.products[0].sku).toBe('DRS-001');
  });

  test('Devuelve 200 con array vacío si no hay productos', async () => {
    const token = await generateTestToken({ role: 'Gerente' });
    const req   = makeRequest('GET', '/api/products', { token });
    const res   = await worker.fetch(req, makeEnv(), {});

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.products)).toBe(true);
  });

});

describe('POST /api/products', () => {

  test('Devuelve 400 si faltan campos requeridos', async () => {
    const token = await generateTestToken({ role: 'Admin' });
    const req   = makeRequest('POST', '/api/products', {
      token,
      body: { name: 'Sin SKU ni precio' }, // faltan campos
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
  });

  test('Devuelve 400 si el precio es 0 o negativo', async () => {
    const token = await generateTestToken({ role: 'Admin' });
    const req   = makeRequest('POST', '/api/products', {
      token,
      body: { sku: 'SKU-001', name: 'Test', category_id: 'c1', price: -100, cost: 50, stock: 1 },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/precio/i);
  });

  test('Crea producto correctamente con datos válidos', async () => {
    const token = await generateTestToken({ role: 'Admin', id: 'usr_admin' });

    const dbMock = {
      prepare: jest.fn().mockReturnValue({
        bind:  jest.fn().mockReturnThis(),
        run:   jest.fn().mockResolvedValue({ success: true }),
        first: jest.fn().mockResolvedValue({
          id: 'prd_new', sku: 'DRS-NEW', name: 'Nuevo Vestido',
          price: 2500, cost: 1000, stock: 10, is_active: 1,
          category_name: 'Noche',
        }),
        all: jest.fn().mockResolvedValue({ results: [] }),
      }),
    };

    const req = makeRequest('POST', '/api/products', {
      token,
      body: { sku: 'DRS-NEW', name: 'Nuevo Vestido', category_id: 'cat_001', price: 2500, cost: 1000, stock: 10 },
    });
    const res = await worker.fetch(req, makeEnv(dbMock), {});

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.product).toBeDefined();
    expect(data.product.sku).toBe('DRS-NEW');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Ventas
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/sales', () => {

  test('Devuelve 400 si no hay items', async () => {
    const token = await generateTestToken({ role: 'Ventas' });
    const req   = makeRequest('POST', '/api/sales', {
      token,
      body: { customer_name: 'Ana', payment_method: 'Efectivo', items: [] },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/producto/i);
  });

  test('Devuelve 400 si el método de pago es inválido', async () => {
    const token = await generateTestToken({ role: 'Ventas' });
    const req   = makeRequest('POST', '/api/sales', {
      token,
      body: {
        customer_name: 'Ana',
        payment_method: 'Bitcoin', // inválido
        items: [{ product_id: 'p1', quantity: 1 }],
      },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Método de pago inválido/i);
  });

  test('Devuelve 400 si el producto no tiene stock suficiente', async () => {
    const token = await generateTestToken({ role: 'Ventas' });

    const dbMock = {
      prepare: jest.fn().mockReturnValue({
        bind:  jest.fn().mockReturnThis(),
        all:   jest.fn().mockResolvedValue({
          results: [{ id: 'p1', name: 'Vestido Test', price: 1000, stock: 2, is_active: 1 }],
        }),
        first: jest.fn().mockResolvedValue(null),
        run:   jest.fn().mockResolvedValue({ success: true }),
      }),
    };

    const req = makeRequest('POST', '/api/sales', {
      token,
      body: {
        customer_name:  'Ana Torres',
        payment_method: 'Efectivo',
        items: [{ product_id: 'p1', quantity: 10 }], // pide 10, hay 2
      },
    });
    const res = await worker.fetch(req, makeEnv(dbMock), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Stock insuficiente/i);
  });

  test('Devuelve 400 si falta el nombre del cliente', async () => {
    const token = await generateTestToken({ role: 'Ventas' });
    const req   = makeRequest('POST', '/api/sales', {
      token,
      body: { payment_method: 'Efectivo', items: [{ product_id: 'p1', quantity: 1 }] },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
  });

});

describe('PATCH /api/sales/:id/approve', () => {

  test('Rol Ventas no puede aprobar ventas', async () => {
    const token = await generateTestToken({ role: 'Ventas' });
    const req   = makeRequest('PATCH', '/api/sales/sal_001/approve', { token });
    const res   = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(403);
  });

  test('Devuelve 404 si la venta no existe', async () => {
    const token = await generateTestToken({ role: 'Gerente' });

    const dbMock = {
      prepare: jest.fn().mockReturnValue({
        bind:  jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null), // venta no encontrada
        run:   jest.fn().mockResolvedValue({ success: true }),
        all:   jest.fn().mockResolvedValue({ results: [] }),
      }),
    };

    const req = makeRequest('PATCH', '/api/sales/sal_inexistente/approve', { token });
    const res = await worker.fetch(req, makeEnv(dbMock), {});
    expect(res.status).toBe(404);
  });

  test('Devuelve 400 si la venta ya está Completada', async () => {
    const token = await generateTestToken({ role: 'Admin' });

    const dbMock = {
      prepare: jest.fn().mockReturnValue({
        bind:  jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({ id: 'sal_001', status: 'Completada' }),
        run:   jest.fn().mockResolvedValue({ success: true }),
        all:   jest.fn().mockResolvedValue({ results: [] }),
      }),
    };

    const req = makeRequest('PATCH', '/api/sales/sal_001/approve', { token });
    const res = await worker.fetch(req, makeEnv(dbMock), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Pendientes/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — Usuarios
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/users', () => {

  test('Devuelve 400 si el rol es inválido', async () => {
    const token = await generateTestToken({ role: 'Admin' });
    const req   = makeRequest('POST', '/api/users', {
      token,
      body: { email: 'x@x.com', password: '12345678', name: 'X', role: 'SuperAdmin' },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Rol inválido/i);
  });

  test('Devuelve 400 si la contraseña es muy corta', async () => {
    const token = await generateTestToken({ role: 'Admin' });
    const req   = makeRequest('POST', '/api/users', {
      token,
      body: { email: 'x@x.com', password: '123', name: 'X', role: 'Ventas' },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/8 caracteres/i);
  });

});

describe('PATCH /api/users/:id/toggle', () => {

  test('Admin no puede desactivarse a sí mismo', async () => {
    const token = await generateTestToken({ role: 'Admin', id: 'usr_admin001' });
    const req   = makeRequest('PATCH', '/api/users/usr_admin001/toggle', {
      token,
      body: { is_active: 0 },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/propia cuenta/i);
  });

  test('Devuelve 400 si is_active no es 0 o 1', async () => {
    const token = await generateTestToken({ role: 'Admin', id: 'usr_admin001' });
    const req   = makeRequest('PATCH', '/api/users/usr_otro/toggle', {
      token,
      body: { is_active: 99 }, // valor inválido
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(400);
  });

});
