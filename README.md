# DressFlow System
> **Infraestructura para el Desarrollo Continuo | Proyecto Final**

![Build Status](https://img.shields.io/github/actions/workflow/status/TU_USUARIO/TU_REPO/deploy.yml?branch=main&style=for-the-badge)
![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)

## 📋 Descripción
DressFlow es una plataforma web *serverless* diseñada para la gestión de inventario y ventas en boutiques de vestidos. El proyecto se centra en la implementación de un pipeline de **CI/CD** robusto, utilizando GitHub Actions para automatizar el testing y el despliegue en la red global de Cloudflare.

## 🛠️ Stack Tecnológico
* **Framework:** Next.js / React
* **Runtime:** Cloudflare Workers & Pages
* **Base de Datos:** Cloudflare D1 (SQL)
* **Automatización:** GitHub Actions
* **Contenedores:** Docker Hub
* **Lenguaje:** TypeScript / JavaScript

## 🏗️ Infraestructura y CI/CD
El proyecto implementa un flujo de desarrollo continuo:
1. **Push:** Envío de código a la rama `main`.
2. **Testing:** Ejecución de pruebas unitarias dentro de contenedores Docker.
3. **Security:** Gestión de secretos mediante GitHub Secrets.
4. **Deploy:** Publicación automática en Cloudflare mediante Wrangler CLI.

---
*Para más detalles técnicos, consulta nuestra [Wiki](../../wiki).*
