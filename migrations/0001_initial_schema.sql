-- =============================================================================
-- DressFlow — Migración Inicial del Esquema
-- Archivo: migrations/0001_initial_schema.sql
--
-- Base de datos: Cloudflare D1 (SQLite-compatible)
-- Versión: 1.0.0
--
-- Tablas:
--   1. users         → Usuarios del sistema con roles (Admin, Gerente, Ventas)
--   2. products      → Catálogo de vestidos
--   3. categories    → Categorías de vestidos
--   4. sales         → Registro de ventas
--   5. sale_items    → Detalle de artículos por venta
--   6. sessions      → Control de sesiones activas
-- =============================================================================

-- Habilitar soporte de claves foráneas en SQLite (D1)
PRAGMA foreign_keys = ON;

-- =============================================================================
-- TABLA: users
-- Almacena todos los usuarios del sistema con control de acceso por roles.
-- Roles disponibles:
--   · Admin   → Acceso total: CRUD usuarios, productos, ventas, reportes
--   · Gerente → Lectura total + aprobar/anular ventas + ver reportes
--   · Ventas  → Solo registrar ventas y consultar productos disponibles
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              TEXT        PRIMARY KEY,            -- UUID: usr_XXXXXXXX
    email           TEXT        NOT NULL UNIQUE,        -- Email único para login
    password_hash   TEXT        NOT NULL,               -- bcrypt hash (nunca texto plano)
    name            TEXT        NOT NULL,               -- Nombre completo del usuario
    role            TEXT        NOT NULL                -- Rol del sistema
                    CHECK (role IN ('Admin', 'Gerente', 'Ventas')),
    is_active       INTEGER     NOT NULL DEFAULT 1      -- 1=activo, 0=desactivado
                    CHECK (is_active IN (0, 1)),
    avatar_url      TEXT,                               -- URL de foto de perfil (opcional)
    phone           TEXT,                               -- Teléfono de contacto
    last_login_at   TEXT,                               -- ISO 8601: última sesión
    created_at      TEXT        NOT NULL                -- ISO 8601: fecha de creación
                    DEFAULT (datetime('now')),
    updated_at      TEXT        NOT NULL
                    DEFAULT (datetime('now'))
);

-- Índices para optimizar consultas frecuentes sobre users
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- =============================================================================
-- TABLA: categories
-- Clasificación de vestidos (Noche, Novia, Quinceañera, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
    id          TEXT    PRIMARY KEY,                    -- UUID: cat_XXXXXXXX
    name        TEXT    NOT NULL UNIQUE,                -- Ej: "Vestidos de Noche"
    slug        TEXT    NOT NULL UNIQUE,                -- URL-friendly: "vestidos-de-noche"
    description TEXT,                                   -- Descripción de la categoría
    color_hex   TEXT    DEFAULT '#C9A84C',              -- Color para UI (HEX)
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Datos de categorías base (insertos iniciales)
INSERT OR IGNORE INTO categories (id, name, slug, description, color_hex) VALUES
    ('cat_001', 'Vestidos de Noche',       'vestidos-de-noche',       'Elegantes para eventos formales y galas', '#1A1A2E'),
    ('cat_002', 'Vestidos de Novia',       'vestidos-de-novia',       'Colección nupcial para el día especial', '#F8F4F0'),
    ('cat_003', 'Vestidos de Quinceañera', 'vestidos-de-quincea-era', 'Diseños para celebraciones de 15 años', '#D4A8D0'),
    ('cat_004', 'Vestidos de Cóctel',      'vestidos-de-coctel',      'Semi-formales para eventos sociales', '#C9A84C'),
    ('cat_005', 'Vestidos Casual',         'vestidos-casual',         'Modelos para uso diario y salidas', '#7EB8B7');

-- =============================================================================
-- TABLA: products
-- Catálogo completo de vestidos con inventario y precios.
-- =============================================================================
CREATE TABLE IF NOT EXISTS products (
    id              TEXT        PRIMARY KEY,            -- UUID: prd_XXXXXXXX
    sku             TEXT        NOT NULL UNIQUE,        -- Código único: DRS-2024-001
    name            TEXT        NOT NULL,               -- Nombre del modelo
    description     TEXT,                               -- Descripción detallada
    category_id     TEXT        NOT NULL,               -- FK → categories.id
    price           REAL        NOT NULL                -- Precio de venta (MXN)
                    CHECK (price > 0),
    cost            REAL        NOT NULL                -- Costo de adquisición (MXN)
                    CHECK (cost >= 0),
    stock           INTEGER     NOT NULL DEFAULT 0      -- Unidades en inventario
                    CHECK (stock >= 0),
    size            TEXT,                               -- Talla disponible (XS,S,M,L,XL,XXL o personalizada)
    color           TEXT,                               -- Color principal del vestido
    brand           TEXT,                               -- Marca o diseñador
    image_url       TEXT,                               -- URL de imagen principal
    is_active       INTEGER     NOT NULL DEFAULT 1      -- 1=publicado, 0=archivado
                    CHECK (is_active IN (0, 1)),
    created_by      TEXT        NOT NULL,               -- FK → users.id (quién lo registró)
    created_at      TEXT        NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT        NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by)  REFERENCES users(id)      ON DELETE RESTRICT
);

-- Índices para búsquedas y filtros frecuentes en el catálogo
CREATE INDEX IF NOT EXISTS idx_products_sku         ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active   ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_price       ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_stock       ON products(stock);

-- =============================================================================
-- TABLA: sales
-- Registro principal de cada transacción de venta.
-- Estados del ciclo de vida de una venta:
--   Pendiente → Completada  (flujo normal)
--   Pendiente → Cancelada   (cancelación antes de cobrar)
--   Completada → Devuelta   (devolución post-venta, requiere Gerente/Admin)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sales (
    id              TEXT        PRIMARY KEY,            -- UUID: sal_XXXXXXXX
    folio           TEXT        NOT NULL UNIQUE,        -- Folio legible: VTA-2024-00001
    status          TEXT        NOT NULL DEFAULT 'Pendiente'
                    CHECK (status IN ('Pendiente', 'Completada', 'Cancelada', 'Devuelta')),
    customer_name   TEXT        NOT NULL,               -- Nombre del cliente
    customer_email  TEXT,                               -- Email del cliente (opcional)
    customer_phone  TEXT,                               -- Teléfono del cliente
    subtotal        REAL        NOT NULL DEFAULT 0      -- Suma de items sin descuento
                    CHECK (subtotal >= 0),
    discount        REAL        NOT NULL DEFAULT 0      -- Descuento total aplicado
                    CHECK (discount >= 0),
    tax             REAL        NOT NULL DEFAULT 0      -- IVA (16% en México)
                    CHECK (tax >= 0),
    total           REAL        NOT NULL DEFAULT 0      -- Total final a cobrar
                    CHECK (total >= 0),
    payment_method  TEXT                                -- Efectivo, Tarjeta, Transferencia
                    CHECK (payment_method IN ('Efectivo', 'Tarjeta de Crédito', 'Tarjeta de Débito', 'Transferencia', NULL)),
    notes           TEXT,                               -- Notas u observaciones
    sold_by         TEXT        NOT NULL,               -- FK → users.id (vendedor)
    approved_by     TEXT,                               -- FK → users.id (Gerente/Admin que aprobó)
    cancelled_by    TEXT,                               -- FK → users.id (quién canceló)
    cancellation_reason TEXT,                           -- Motivo de cancelación
    sold_at         TEXT        NOT NULL                -- Fecha/hora de la venta
                    DEFAULT (datetime('now')),
    created_at      TEXT        NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT        NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (sold_by)      REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by)  REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- Índices para reportes y consultas por período/estado/vendedor
CREATE INDEX IF NOT EXISTS idx_sales_status     ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_sold_by    ON sales(sold_by);
CREATE INDEX IF NOT EXISTS idx_sales_sold_at    ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_folio      ON sales(folio);

-- =============================================================================
-- TABLA: sale_items
-- Detalle de cada vestido incluido en una venta (relación N:M entre sales y products).
-- Se almacena el precio al momento de la venta para preservar historial exacto.
-- =============================================================================
CREATE TABLE IF NOT EXISTS sale_items (
    id              TEXT    PRIMARY KEY,                -- UUID: sit_XXXXXXXX
    sale_id         TEXT    NOT NULL,                   -- FK → sales.id
    product_id      TEXT    NOT NULL,                   -- FK → products.id
    quantity        INTEGER NOT NULL DEFAULT 1          -- Cantidad vendida
                    CHECK (quantity > 0),
    unit_price      REAL    NOT NULL                    -- Precio unitario en el momento de la venta
                    CHECK (unit_price >= 0),
    discount        REAL    NOT NULL DEFAULT 0          -- Descuento aplicado a este ítem
                    CHECK (discount >= 0),
    subtotal        REAL    NOT NULL                    -- (quantity * unit_price) - discount
                    CHECK (subtotal >= 0),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (sale_id)    REFERENCES sales(id)    ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- =============================================================================
-- TABLA: sessions
-- Control de sesiones JWT activas para invalidación segura (logout, expiración).
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT    PRIMARY KEY,                    -- UUID: ses_XXXXXXXX
    user_id     TEXT    NOT NULL,                       -- FK → users.id
    token_hash  TEXT    NOT NULL UNIQUE,                -- Hash SHA-256 del JWT
    ip_address  TEXT,                                   -- IP de origen de la sesión
    user_agent  TEXT,                                   -- Browser/dispositivo
    is_active   INTEGER NOT NULL DEFAULT 1              -- 1=válida, 0=invalidada
                CHECK (is_active IN (0, 1)),
    expires_at  TEXT    NOT NULL,                       -- Expiración ISO 8601
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_is_active  ON sessions(is_active);

-- =============================================================================
-- TRIGGER: Actualizar updated_at automáticamente en users
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
    AFTER UPDATE ON users
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- TRIGGER: Actualizar updated_at automáticamente en products
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS trg_products_updated_at
    AFTER UPDATE ON products
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE products SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- TRIGGER: Actualizar updated_at automáticamente en sales
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS trg_sales_updated_at
    AFTER UPDATE ON sales
    FOR EACH ROW
    WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE sales SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- TRIGGER: Reducir stock de producto al confirmar una venta
-- Se ejecuta cuando sale_items recibe un nuevo registro
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS trg_reduce_stock_on_sale
    AFTER INSERT ON sale_items
    FOR EACH ROW
BEGIN
    UPDATE products
    SET stock = stock - NEW.quantity
    WHERE id = NEW.product_id;
END;

-- =============================================================================
-- TRIGGER: Restaurar stock al cancelar o devolver una venta
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS trg_restore_stock_on_cancel
    AFTER UPDATE ON sales
    FOR EACH ROW
    WHEN (NEW.status = 'Cancelada' OR NEW.status = 'Devuelta')
      AND OLD.status NOT IN ('Cancelada', 'Devuelta')
BEGIN
    UPDATE products
    SET stock = stock + (
        SELECT COALESCE(SUM(si.quantity), 0)
        FROM sale_items si
        WHERE si.sale_id = NEW.id AND si.product_id = products.id
    )
    WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = NEW.id);
END;

-- =============================================================================
-- VISTA: v_sales_summary
-- Resumen de ventas con datos del vendedor para reportes rápidos.
-- =============================================================================
CREATE VIEW IF NOT EXISTS v_sales_summary AS
SELECT
    s.id,
    s.folio,
    s.status,
    s.customer_name,
    s.total,
    s.payment_method,
    s.sold_at,
    u.name     AS seller_name,
    u.role     AS seller_role,
    COUNT(si.id) AS items_count
FROM sales s
JOIN users      u  ON s.sold_by   = u.id
LEFT JOIN sale_items si ON s.id = si.sale_id
GROUP BY s.id;

-- =============================================================================
-- VISTA: v_product_catalog
-- Catálogo activo con nombre de categoría y margen de ganancia.
-- =============================================================================
CREATE VIEW IF NOT EXISTS v_product_catalog AS
SELECT
    p.id,
    p.sku,
    p.name,
    p.price,
    p.cost,
    ROUND((p.price - p.cost) / p.price * 100, 2) AS margin_pct,
    p.stock,
    p.size,
    p.color,
    p.is_active,
    c.name  AS category_name,
    c.slug  AS category_slug
FROM products p
JOIN categories c ON p.category_id = c.id;