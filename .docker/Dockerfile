# =============================================================================
# DressFlow — Dockerfile
# Archivo: .docker/Dockerfile
#
# Propósito: Imagen optimizada para ejecutar pruebas locales y simular el
#            entorno de Cloudflare Workers usando Wrangler CLI con Miniflare.
#
# Etapas:
#   1. base         → Node.js + dependencias del sistema
#   2. dependencies → Instalación de paquetes npm
#   3. test         → Entorno para ejecutar pruebas unitarias
#   4. dev          → Entorno de desarrollo local con hot-reload
# =============================================================================

# ── Etapa 1: Imagen base ─────────────────────────────────────────────────────
FROM node:20-alpine AS base

# Metadatos de la imagen
LABEL maintainer="DressFlow Team"
LABEL description="DressFlow - Sistema de gestión de tienda de vestidos"
LABEL version="1.0.0"

# Instalar dependencias del sistema operativo necesarias para Wrangler/SQLite
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    sqlite-dev \
    curl \
    git \
    # Para generar reportes de cobertura
    && rm -rf /var/cache/apk/*

# Crear usuario no-root para seguridad (no ejecutar como root en producción)
RUN addgroup -g 1001 -S dressflow && \
    adduser -u 1001 -S dressflow -G dressflow

# Directorio de trabajo del proyecto
WORKDIR /app

# ── Etapa 2: Instalación de dependencias ─────────────────────────────────────
FROM base AS dependencies

# Copiar solo archivos de manifiesto primero (aprovecha cache de Docker)
# Si package.json no cambia, Docker reutiliza esta capa en el siguiente build
COPY package.json package-lock.json* ./

# Instalar todas las dependencias (incluyendo devDependencies para pruebas)
RUN npm ci --include=dev

# Instalar Wrangler globalmente para simular el entorno de Cloudflare
RUN npm install -g wrangler@3

# ── Etapa 3: Entorno de pruebas ───────────────────────────────────────────────
FROM dependencies AS test

# Copiar el código fuente del proyecto
COPY --chown=dressflow:dressflow . .

# Variables de entorno para el entorno de pruebas
ENV NODE_ENV=test
ENV CI=true
ENV JWT_SECRET=test-secret-for-docker-only
ENV APP_NAME=DressFlow
ENV APP_VERSION=1.0.0

# Cambiar al usuario no-root
USER dressflow

# Comando por defecto: ejecutar pruebas con cobertura
CMD ["npm", "test", "--", "--coverage", "--watchAll=false"]

# ── Etapa 4: Entorno de desarrollo ────────────────────────────────────────────
FROM dependencies AS dev

# Copiar código fuente
COPY --chown=dressflow:dressflow . .

# Variables de entorno para desarrollo local
ENV NODE_ENV=development
ENV PORT=8787
ENV APP_NAME=DressFlow

# Exponer el puerto que usa Wrangler para el servidor local
EXPOSE 8787

# Cambiar al usuario no-root
USER dressflow

# Comando: iniciar servidor de desarrollo con Wrangler
# Miniflare simulará el runtime de Cloudflare Workers localmente
CMD ["wrangler", "pages", "dev", "src/", "--port", "8787", "--local"]

# ── Health check ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8787/ || exit 1