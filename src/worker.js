// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 1 — UTILIDADES JWT (Web Crypto API, nativa en Cloudflare Workers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte un string a ArrayBuffer (necesario para la Web Crypto API).
 */
const strToBuffer = str => new TextEncoder().encode(str);

/**
 * Convierte un ArrayBuffer a string Base64URL (formato de JWT).
 */
const bufToBase64url = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Importa el JWT_SECRET como CryptoKey para operaciones HMAC-SHA256.
 * Se llama una sola vez y se reutiliza por request (Cloudflare cachea en memoria).
 *
 * @param {string} secret
 * @returns {Promise<CryptoKey>}
 */
async function importJwtKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    strToBuffer(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Genera un token JWT firmado con HMAC-SHA256.
 *
 * Payload incluye:
 *   · sub  → user ID
 *   · role → rol del usuario (Admin | Gerente | Ventas)
 *   · name → nombre completo
 *   · iat  → issued at (unix timestamp)
 *   · exp  → expiration (iat + expirySeconds)
 *
 * @param {object} payload
 * @param {string} secret
 * @param {number} expirySeconds
 * @returns {Promise<string>} JWT completo
 */
async function signJwt(payload, secret, expirySeconds = 86400) {
  const key = await importJwtKey(secret);

  const header  = bufToBase64url(strToBuffer(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now     = Math.floor(Date.now() / 1000);
  const body    = bufToBase64url(strToBuffer(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expirySeconds,
  })));

  const signature = bufToBase64url(
    await crypto.subtle.sign('HMAC', key, strToBuffer(`${header}.${body}`))
  );

  return `${header}.${body}.${signature}`;
}

/**
 * Verifica y decodifica un JWT.
 * Lanza un error si la firma es inválida o el token expiró.
 *
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<object>} Payload decodificado
 */
async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Formato de token inválido');

  const [header, body, sig] = parts;
  const key = await importJwtKey(secret);

  // Verificar firma
  const sigBuf = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid  = await crypto.subtle.verify('HMAC', key, sigBuf, strToBuffer(`${header}.${body}`));
  if (!valid) throw new Error('Firma JWT inválida');

  // Decodificar payload
  const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));

  // Verificar expiración
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expirado');

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 2 — HASHING DE CONTRASEÑAS (PBKDF2 nativo)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera un hash seguro de contraseña usando PBKDF2 + sal aleatoria.
 * Formato de salida: "salt:hash" (ambos en hex) para almacenar en D1.
 *
 * @param {string} password Contraseña en texto plano
 * @returns {Promise<string>} "salt:hash"
 */
async function hashPassword(password) {
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const keyMat  = await crypto.subtle.importKey('raw', strToBuffer(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMat,
    256
  );

  const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
  return `${toHex(salt)}:${toHex(derived)}`;
}

/**
 * Compara una contraseña en texto plano contra un hash almacenado.
 *
 * @param {string} password     Texto plano ingresado por el usuario
 * @param {string} storedHash   "salt:hash" guardado en D1
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, storedHash) {
  try {
    const [saltHex, hashHex] = storedHash.split(':');
    const salt    = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const keyMat  = await crypto.subtle.importKey('raw', strToBuffer(password), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
      keyMat,
      256
    );

    const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
    return toHex(derived) === hashHex;
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 3 — HELPERS DE RESPUESTA HTTP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea una respuesta JSON con el código de status indicado.
 *
 * @param {object|array} data
 * @param {number} status
 * @param {object} extraHeaders
 * @returns {Response}
 */
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

const ok      = data            => json(data, 200);
const created = data            => json(data, 201);
const noContent = ()            => new Response(null, { status: 204 });
const badRequest = msg          => json({ error: true, message: msg }, 400);
const unauthorized = msg        => json({ error: true, message: msg || 'No autorizado' }, 401);
const forbidden = msg           => json({ error: true, message: msg || 'Acceso denegado' }, 403);
const notFound = msg            => json({ error: true, message: msg || 'No encontrado' }, 404);
const serverError = (msg, err)  => {
  console.error('[DressFlow Worker Error]', msg, err?.message || err);
  return json({ error: true, message: msg || 'Error interno del servidor' }, 500);
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 4 — MIDDLEWARE CORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agrega headers CORS a una respuesta.
 * El origen permitido se configura en wrangler.toml via ALLOWED_ORIGINS.
 *
 * @param {Response} response
 * @param {string} allowedOrigins  Valor de env.ALLOWED_ORIGINS
 * @param {string} requestOrigin   Header Origin del request
 * @returns {Response}
 */
function withCors(response, allowedOrigins, requestOrigin) {
  const origins = (allowedOrigins || '*').split(',').map(o => o.trim());
  const origin  = origins.includes(requestOrigin) ? requestOrigin : origins[0];

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, { status: response.status, headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 5 — MIDDLEWARE DE AUTENTICACIÓN RBAC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrae y verifica el JWT del header Authorization.
 * Retorna el payload del token si es válido, o null si no lo es.
 *
 * @param {Request} request
 * @param {string} jwtSecret
 * @returns {Promise<object|null>} payload | null
 */
async function getAuthPayload(request, jwtSecret) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    return await verifyJwt(token, jwtSecret);
  } catch (_) {
    return null;
  }
}

/**
 * Middleware de autorización por rol.
 * Retorna el payload del usuario autenticado o una Response de error.
 *
 * Uso:
 *   const auth = await requireRole(request, env, ['Admin', 'Gerente']);
 *   if (auth instanceof Response) return auth; // Error 401/403
 *   // auth.sub, auth.role, auth.name disponibles
 *
 * @param {Request} request
 * @param {object} env           Variables de entorno del Worker
 * @param {string[]} allowedRoles Roles permitidos para esta ruta
 * @returns {Promise<object|Response>}
 */
async function requireRole(request, env, allowedRoles) {
  const payload = await getAuthPayload(request, env.JWT_SECRET);

  if (!payload) return unauthorized('Token inválido o sesión expirada');
  if (!allowedRoles.includes(payload.role)) {
    return forbidden(`El rol "${payload.role}" no tiene acceso a este recurso`);
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 6 — UTILIDADES DE BASE DE DATOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera un ID único con el prefijo dado.
 * Ejemplo: genId('usr') → "usr_a3f8c2d1e4b5"
 *
 * @param {string} prefix
 * @returns {string}
 */
function genId(prefix) {
  const rand = bufToBase64url(crypto.getRandomValues(new Uint8Array(8)))
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 12)
    .toLowerCase();
  return `${prefix}_${rand}`;
}

/**
 * Genera un folio legible para ventas.
 * Formato: VTA-YYYY-NNNNN
 *
 * @param {object} db  Binding de D1
 * @returns {Promise<string>}
 */
async function generateFolio(db) {
  const year  = new Date().getFullYear();
  const { results } = await db.prepare(
    `SELECT COUNT(*) as total FROM sales WHERE strftime('%Y', sold_at) = ?`
  ).bind(String(year)).all();
  const seq = ((results[0]?.total || 0) + 1).toString().padStart(5, '0');
  return `VTA-${year}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 7 — HANDLERS DE RUTAS
// ─────────────────────────────────────────────────────────────────────────────

// ── 7.1 Auth: Login ──────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { email: string, password: string }
 *
 * Flujo:
 *  1. Busca el usuario por email en D1
 *  2. Verifica la contraseña con PBKDF2
 *  3. Actualiza last_login_at
 *  4. Devuelve un JWT + datos del usuario
 */
async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return badRequest('El cuerpo de la petición no es JSON válido');
  }

  const { email, password } = body;

  if (!email || !password) return badRequest('Email y contraseña son requeridos');
  if (typeof email !== 'string' || typeof password !== 'string') {
    return badRequest('Formato inválido');
  }

  try {
    // Buscar usuario activo por email
    const { results } = await env.DB.prepare(
      `SELECT id, email, password_hash, name, role, is_active
       FROM users
       WHERE email = ? COLLATE NOCASE
       LIMIT 1`
    ).bind(email.trim().toLowerCase()).all();

    const user = results[0];

    // Respuesta genérica para no revelar si el email existe o no (seguridad)
    if (!user || !user.is_active) {
      return unauthorized('Credenciales incorrectas');
    }

    // Verificar contraseña
    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) return unauthorized('Credenciales incorrectas');

    // Actualizar timestamp de último login
    await env.DB.prepare(
      `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`
    ).bind(user.id).run();

    // Generar JWT (expira en 24 horas por defecto)
    const expirySeconds = parseInt(env.JWT_EXPIRY_SECONDS || '86400', 10);
    const token = await signJwt(
      { sub: user.id, role: user.role, name: user.name, email: user.email },
      env.JWT_SECRET,
      expirySeconds
    );

    return ok({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });

  } catch (err) {
    return serverError('Error al procesar el login', err);
  }
}

// ── 7.2 Auth: Logout ─────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout
 * Header: Authorization: Bearer <token>
 *
 * En Workers stateless no hay sesión que invalidar en servidor,
 * pero podríamos registrar el token como revocado en D1 si fuera necesario.
 * Por ahora devuelve 204 y el cliente borra el token de sessionStorage.
 */
async function handleLogout(request, env) {
  const payload = await getAuthPayload(request, env.JWT_SECRET);
  if (!payload) return unauthorized();

  // Aquí se podría insertar el token en una tabla de revocaciones.
  // Para esta implementación el logout es client-side (borrar sessionStorage).
  return noContent();
}

// ── 7.3 Dashboard ─────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard
 * Roles: todos
 *
 * Devuelve métricas agregadas para la pantalla principal.
 * Los datos se calculan directamente en D1 para evitar procesamiento en el Worker.
 */
async function handleDashboard(request, env) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente', 'Ventas']);
  if (auth instanceof Response) return auth;

  try {
    const [salesStats, productStats, userStats, recentSales] = await Promise.all([
      // Ventas del mes actual y totales
      env.DB.prepare(`
        SELECT
          COUNT(*) as total_sales,
          COUNT(CASE WHEN status = 'Completada' THEN 1 END) as completed_sales,
          COALESCE(SUM(CASE WHEN status = 'Completada' THEN total END), 0) as total_revenue
        FROM sales
        WHERE strftime('%Y-%m', sold_at) = strftime('%Y-%m', 'now')
      `).first(),

      // Productos activos
      env.DB.prepare(
        `SELECT COUNT(*) as total FROM products WHERE is_active = 1`
      ).first(),

      // Usuarios activos
      env.DB.prepare(
        `SELECT COUNT(*) as total FROM users WHERE is_active = 1`
      ).first(),

      // Últimas 5 ventas con nombre del vendedor (usando la vista)
      env.DB.prepare(
        `SELECT * FROM v_sales_summary ORDER BY sold_at DESC LIMIT 5`
      ).all(),
    ]);

    return ok({
      metrics: {
        sales_this_month:  salesStats?.total_sales     || 0,
        completed_sales:   salesStats?.completed_sales || 0,
        revenue_this_month: salesStats?.total_revenue  || 0,
        active_products:   productStats?.total         || 0,
        active_users:      userStats?.total            || 0,
      },
      recent_sales: recentSales.results || [],
    });

  } catch (err) {
    return serverError('Error al cargar el dashboard', err);
  }
}

// ── 7.4 Productos: GET ────────────────────────────────────────────────────────

/**
 * GET /api/products
 * Roles: todos
 * Query params: ?active=true | ?category=cat_001 | ?search=noir | ?count=true
 *
 * Usa la vista v_product_catalog que incluye el nombre de categoría y margen.
 */
async function handleGetProducts(request, env) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente', 'Ventas']);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const onlyActive = searchParams.get('active') === 'true';
  const category   = searchParams.get('category');
  const search     = searchParams.get('search');

  try {
    let query  = `SELECT * FROM v_product_catalog WHERE 1=1`;
    const bindings = [];

    if (onlyActive) {
      query += ` AND is_active = 1`;
    }
    if (category) {
      query += ` AND category_slug = ?`;
      bindings.push(category);
    }
    if (search) {
      query += ` AND (name LIKE ? OR sku LIKE ? OR color LIKE ?)`;
      const term = `%${search}%`;
      bindings.push(term, term, term);
    }

    query += ` ORDER BY name ASC`;

    const stmt = bindings.length
      ? env.DB.prepare(query).bind(...bindings)
      : env.DB.prepare(query);

    const { results } = await stmt.all();
    return ok({ products: results });

  } catch (err) {
    return serverError('Error al obtener productos', err);
  }
}

// ── 7.5 Productos: POST (crear) ───────────────────────────────────────────────

/**
 * POST /api/products
 * Roles: Admin, Gerente
 * Body: { sku, name, category_id, price, cost, stock, size?, color?, brand?, description? }
 */
async function handleCreateProduct(request, env) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await request.json(); }
  catch (_) { return badRequest('JSON inválido'); }

  const { sku, name, category_id, price, cost, stock } = body;

  if (!sku || !name || !category_id || price == null || cost == null || stock == null) {
    return badRequest('Campos requeridos: sku, name, category_id, price, cost, stock');
  }
  if (price <= 0)  return badRequest('El precio debe ser mayor a 0');
  if (cost < 0)    return badRequest('El costo no puede ser negativo');
  if (stock < 0)   return badRequest('El stock no puede ser negativo');

  try {
    const id = genId('prd');

    await env.DB.prepare(`
      INSERT INTO products
        (id, sku, name, description, category_id, price, cost, stock, size, color, brand, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, sku.trim(), name.trim(),
      body.description || null,
      category_id,
      parseFloat(price),
      parseFloat(cost),
      parseInt(stock, 10),
      body.size  || null,
      body.color || null,
      body.brand || null,
      auth.sub
    ).run();

    const product = await env.DB.prepare(
      `SELECT * FROM v_product_catalog WHERE id = ?`
    ).bind(id).first();

    return created({ product });

  } catch (err) {
    if (err.message?.includes('UNIQUE')) return badRequest('El SKU ya existe');
    return serverError('Error al crear producto', err);
  }
}

// ── 7.6 Productos: PUT (actualizar) ──────────────────────────────────────────

/**
 * PUT /api/products/:id
 * Roles: Admin, Gerente
 */
async function handleUpdateProduct(request, env, productId) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await request.json(); }
  catch (_) { return badRequest('JSON inválido'); }

  try {
    // Verificar que el producto existe
    const existing = await env.DB.prepare(
      `SELECT id FROM products WHERE id = ?`
    ).bind(productId).first();
    if (!existing) return notFound('Producto no encontrado');

    // Construir UPDATE dinámico con solo los campos enviados
    const allowed = ['name','description','price','cost','stock','size','color','brand','is_active'];
    const updates = [];
    const values  = [];

    for (const field of allowed) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    if (updates.length === 0) return badRequest('No hay campos a actualizar');

    values.push(productId);
    await env.DB.prepare(
      `UPDATE products SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const product = await env.DB.prepare(
      `SELECT * FROM v_product_catalog WHERE id = ?`
    ).bind(productId).first();

    return ok({ product });

  } catch (err) {
    return serverError('Error al actualizar producto', err);
  }
}

// ── 7.7 Productos: DELETE (archivar) ─────────────────────────────────────────

/**
 * DELETE /api/products/:id
 * Roles: Admin
 * No elimina físicamente — marca is_active = 0 (soft delete).
 */
async function handleDeleteProduct(request, env, productId) {
  const auth = await requireRole(request, env, ['Admin']);
  if (auth instanceof Response) return auth;

  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM products WHERE id = ?`
    ).bind(productId).first();
    if (!existing) return notFound('Producto no encontrado');

    await env.DB.prepare(
      `UPDATE products SET is_active = 0 WHERE id = ?`
    ).bind(productId).run();

    return ok({ message: 'Producto archivado correctamente' });

  } catch (err) {
    return serverError('Error al archivar producto', err);
  }
}

// ── 7.8 Ventas: GET ───────────────────────────────────────────────────────────

/**
 * GET /api/sales
 * Roles: todos (Ventas solo ve sus propias ventas)
 * Query params: ?limit=20 | ?status=Completada | ?from=2024-01-01 | ?to=2024-12-31
 */
async function handleGetSales(request, env) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente', 'Ventas']);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const limit  = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const status = searchParams.get('status');
  const from   = searchParams.get('from');
  const to     = searchParams.get('to');

  try {
    let query    = `SELECT * FROM v_sales_summary WHERE 1=1`;
    const params = [];

    // Ventas solo ve sus propias transacciones (RBAC a nivel de datos)
    if (auth.role === 'Ventas') {
      query += ` AND sold_by = ?`;
      params.push(auth.sub);
    }
    if (status) { query += ` AND status = ?`;     params.push(status); }
    if (from)   { query += ` AND sold_at >= ?`;   params.push(from); }
    if (to)     { query += ` AND sold_at <= ?`;   params.push(to + ' 23:59:59'); }

    query += ` ORDER BY sold_at DESC LIMIT ?`;
    params.push(limit);

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return ok({ sales: results });

  } catch (err) {
    return serverError('Error al obtener ventas', err);
  }
}

// ── 7.9 Ventas: POST (registrar nueva venta) ──────────────────────────────────

/**
 * POST /api/sales
 * Roles: todos
 * Body: {
 *   customer_name, customer_phone?, customer_email?,
 *   payment_method, notes?,
 *   items: [{ product_id, quantity }]
 * }
 *
 * Flujo:
 *  1. Validar que los productos existen y tienen stock suficiente
 *  2. Calcular subtotal, tax (16% IVA) y total
 *  3. Insertar sale + sale_items en una transacción
 *  4. El trigger trg_reduce_stock_on_sale reduce el stock automáticamente
 */
async function handleCreateSale(request, env) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente', 'Ventas']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await request.json(); }
  catch (_) { return badRequest('JSON inválido'); }

  const { customer_name, payment_method, items } = body;

  if (!customer_name?.trim())   return badRequest('El nombre del cliente es requerido');
  if (!payment_method)          return badRequest('El método de pago es requerido');
  if (!Array.isArray(items) || items.length === 0) {
    return badRequest('Se requiere al menos un producto en la venta');
  }

  const VALID_PAYMENTS = ['Efectivo','Tarjeta de Crédito','Tarjeta de Débito','Transferencia'];
  if (!VALID_PAYMENTS.includes(payment_method)) {
    return badRequest(`Método de pago inválido. Opciones: ${VALID_PAYMENTS.join(', ')}`);
  }

  try {
    // Verificar stock de todos los productos antes de crear la venta
    const productIds = [...new Set(items.map(i => i.product_id))];
    const placeholders = productIds.map(() => '?').join(',');
    const { results: products } = await env.DB.prepare(
      `SELECT id, name, price, stock, is_active FROM products WHERE id IN (${placeholders}) AND is_active = 1`
    ).bind(...productIds).all();

    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // Validar cada ítem
    for (const item of items) {
      const product = productMap[item.product_id];
      if (!product)                     return badRequest(`Producto ${item.product_id} no encontrado o inactivo`);
      if (item.quantity < 1)            return badRequest(`Cantidad inválida para ${product.name}`);
      if (product.stock < item.quantity) return badRequest(`Stock insuficiente para "${product.name}". Disponible: ${product.stock}`);
    }

    // Calcular totales
    const TAX_RATE = parseFloat(env.TAX_RATE || '0.16');
    let subtotal = 0;
    const saleItems = items.map(item => {
      const product  = productMap[item.product_id];
      const qty      = parseInt(item.quantity, 10);
      const discount = parseFloat(item.discount || 0);
      const itemSub  = (product.price * qty) - discount;
      subtotal += itemSub;
      return { ...item, unit_price: product.price, quantity: qty, discount, subtotal: itemSub };
    });

    const tax   = subtotal * TAX_RATE;
    const total = subtotal + tax;

    // Insertar venta e ítems
    const saleId = genId('sal');
    const folio  = await generateFolio(env.DB);

    await env.DB.prepare(`
      INSERT INTO sales
        (id, folio, status, customer_name, customer_email, customer_phone,
         subtotal, tax, total, payment_method, notes, sold_by)
      VALUES (?, ?, 'Pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      saleId, folio,
      customer_name.trim(),
      body.customer_email || null,
      body.customer_phone || null,
      subtotal, tax, total,
      payment_method,
      body.notes || null,
      auth.sub
    ).run();

    // Insertar ítems (el trigger reduce el stock automáticamente)
    for (const item of saleItems) {
      await env.DB.prepare(`
        INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, discount, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        genId('sit'), saleId,
        item.product_id, item.quantity,
        item.unit_price, item.discount, item.subtotal
      ).run();
    }

    const sale = await env.DB.prepare(
      `SELECT * FROM v_sales_summary WHERE id = ?`
    ).bind(saleId).first();

    return created({ sale });

  } catch (err) {
    return serverError('Error al registrar la venta', err);
  }
}

// ── 7.10 Ventas: PATCH /approve ───────────────────────────────────────────────

/**
 * PATCH /api/sales/:id/approve
 * Roles: Admin, Gerente
 */
async function handleApproveSale(request, env, saleId) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente']);
  if (auth instanceof Response) return auth;

  try {
    const sale = await env.DB.prepare(
      `SELECT id, status FROM sales WHERE id = ?`
    ).bind(saleId).first();

    if (!sale)                       return notFound('Venta no encontrada');
    if (sale.status !== 'Pendiente') return badRequest(`Solo se pueden aprobar ventas Pendientes. Estado actual: ${sale.status}`);

    await env.DB.prepare(`
      UPDATE sales
      SET status = 'Completada', approved_by = ?
      WHERE id = ?
    `).bind(auth.sub, saleId).run();

    return ok({ message: 'Venta aprobada', sale_id: saleId });

  } catch (err) {
    return serverError('Error al aprobar la venta', err);
  }
}

// ── 7.11 Ventas: PATCH /cancel ────────────────────────────────────────────────

/**
 * PATCH /api/sales/:id/cancel
 * Roles: Admin, Gerente
 * Body: { reason: string }
 * El trigger trg_restore_stock_on_cancel restaura el stock automáticamente.
 */
async function handleCancelSale(request, env, saleId) {
  const auth = await requireRole(request, env, ['Admin', 'Gerente']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await request.json(); }
  catch (_) { body = {}; }

  try {
    const sale = await env.DB.prepare(
      `SELECT id, status FROM sales WHERE id = ?`
    ).bind(saleId).first();

    if (!sale)                                      return notFound('Venta no encontrada');
    if (['Cancelada','Devuelta'].includes(sale.status)) {
      return badRequest(`La venta ya está en estado "${sale.status}"`);
    }

    await env.DB.prepare(`
      UPDATE sales
      SET status = 'Cancelada', cancelled_by = ?, cancellation_reason = ?
      WHERE id = ?
    `).bind(auth.sub, body.reason || null, saleId).run();

    return ok({ message: 'Venta cancelada. Stock restaurado automáticamente.', sale_id: saleId });

  } catch (err) {
    return serverError('Error al cancelar la venta', err);
  }
}

// ── 7.12 Usuarios: GET ────────────────────────────────────────────────────────

/**
 * GET /api/users
 * Roles: Admin
 * Nunca devuelve password_hash.
 */
async function handleGetUsers(request, env) {
  const auth = await requireRole(request, env, ['Admin']);
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(`
      SELECT id, email, name, role, is_active, phone, last_login_at, created_at
      FROM users
      ORDER BY role ASC, name ASC
    `).all();

    return ok({ users: results });

  } catch (err) {
    return serverError('Error al obtener usuarios', err);
  }
}

// ── 7.13 Usuarios: POST (crear) ───────────────────────────────────────────────

/**
 * POST /api/users
 * Roles: Admin
 * Body: { email, password, name, role, phone? }
 */
async function handleCreateUser(request, env) {
  const auth = await requireRole(request, env, ['Admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await request.json(); }
  catch (_) { return badRequest('JSON inválido'); }

  const { email, password, name, role } = body;

  if (!email || !password || !name || !role) {
    return badRequest('Campos requeridos: email, password, name, role');
  }
  if (!['Admin','Gerente','Ventas'].includes(role)) {
    return badRequest('Rol inválido. Opciones: Admin, Gerente, Ventas');
  }
  if (password.length < 8) {
    return badRequest('La contraseña debe tener al menos 8 caracteres');
  }

  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM users WHERE email = ? COLLATE NOCASE`
    ).bind(email.trim().toLowerCase()).first();

    if (existing) return badRequest('Ya existe un usuario con ese email');

    const id       = genId('usr');
    const passHash = await hashPassword(password);

    await env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, name, role, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      email.trim().toLowerCase(),
      passHash,
      name.trim(),
      role,
      body.phone || null
    ).run();

    return created({
      user: { id, email: email.trim().toLowerCase(), name: name.trim(), role },
    });

  } catch (err) {
    return serverError('Error al crear usuario', err);
  }
}

// ── 7.14 Usuarios: PATCH /toggle (activar/desactivar) ────────────────────────

/**
 * PATCH /api/users/:id/toggle
 * Roles: Admin
 * Body: { is_active: 0 | 1 }
 * Un Admin no puede desactivarse a sí mismo.
 */
async function handleToggleUser(request, env, userId) {
  const auth = await requireRole(request, env, ['Admin']);
  if (auth instanceof Response) return auth;

  if (userId === auth.sub) return badRequest('No puedes desactivar tu propia cuenta');

  let body;
  try { body = await request.json(); }
  catch (_) { return badRequest('JSON inválido'); }

  if (body.is_active !== 0 && body.is_active !== 1) {
    return badRequest('is_active debe ser 0 (inactivo) o 1 (activo)');
  }

  try {
    const user = await env.DB.prepare(
      `SELECT id FROM users WHERE id = ?`
    ).bind(userId).first();
    if (!user) return notFound('Usuario no encontrado');

    await env.DB.prepare(
      `UPDATE users SET is_active = ? WHERE id = ?`
    ).bind(body.is_active, userId).run();

    return ok({
      message: body.is_active ? 'Usuario activado' : 'Usuario desactivado',
    });

  } catch (err) {
    return serverError('Error al actualizar usuario', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 8 — ROUTER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enrutador simple basado en method + pathname.
 * No necesita librería externa — pattern matching con startsWith y split.
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function router(request, env) {
  const { method, url } = request;
  const { pathname }    = new URL(url);

  // Preflight CORS (debe responder antes de cualquier auth check)
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // Solo manejar rutas /api/*
  if (!pathname.startsWith('/api/')) {
    return new Response('Not Found', { status: 404 });
  }

  // Extraer segmentos: /api/products/prd_abc/... → ['products','prd_abc',...]
  const segments = pathname.slice(5).split('/').filter(Boolean);
  const [resource, id, action] = segments;

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (resource === 'auth') {
    if (method === 'POST' && id === 'login')  return handleLogin(request, env);
    if (method === 'POST' && id === 'logout') return handleLogout(request, env);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  if (resource === 'dashboard' && method === 'GET') {
    return handleDashboard(request, env);
  }

  // ── Products ──────────────────────────────────────────────────────────────
  if (resource === 'products') {
    if (method === 'GET'    && !id)  return handleGetProducts(request, env);
    if (method === 'POST'   && !id)  return handleCreateProduct(request, env);
    if (method === 'PUT'    && id)   return handleUpdateProduct(request, env, id);
    if (method === 'DELETE' && id)   return handleDeleteProduct(request, env, id);
  }

  // ── Sales ─────────────────────────────────────────────────────────────────
  if (resource === 'sales') {
    if (method === 'GET'   && !id)               return handleGetSales(request, env);
    if (method === 'POST'  && !id)               return handleCreateSale(request, env);
    if (method === 'PATCH' && id && action === 'approve') return handleApproveSale(request, env, id);
    if (method === 'PATCH' && id && action === 'cancel')  return handleCancelSale(request, env, id);
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  if (resource === 'users') {
    if (method === 'GET'   && !id)               return handleGetUsers(request, env);
    if (method === 'POST'  && !id)               return handleCreateUser(request, env);
    if (method === 'PATCH' && id && action === 'toggle') return handleToggleUser(request, env, id);
  }

  return notFound('Ruta no encontrada');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 9 — ENTRY POINT DEL WORKER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cloudflare Workers exporta un objeto con el método `fetch`.
 * Este es el punto de entrada de cada request HTTP.
 *
 * env contiene los bindings definidos en wrangler.toml:
 *   · env.DB             → Cloudflare D1 Database
 *   · env.JWT_SECRET     → Wrangler secret
 *   · env.ALLOWED_ORIGINS → Variable de entorno
 *   · env.TAX_RATE        → Variable de entorno
 */
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    try {
      // Verificar que los bindings esenciales existen
      if (!env.DB) {
        return json({ error: true, message: 'D1 database binding (DB) no configurado' }, 503);
      }
      if (!env.JWT_SECRET) {
        return json({ error: true, message: 'JWT_SECRET no configurado. Ejecuta: wrangler secret put JWT_SECRET' }, 503);
      }

      const response = await router(request, env);
      return withCors(response, env.ALLOWED_ORIGINS, origin);

    } catch (err) {
      console.error('[DressFlow Unhandled Error]', err);
      const errResponse = json({ error: true, message: 'Error interno inesperado' }, 500);
      return withCors(errResponse, env.ALLOWED_ORIGINS, origin);
    }
  },
};
