# 🍃 EcoTracker

Sarah Martínez y Pablo Quintero

![CI/CD Backend](https://img.shields.io/badge/CI%2FCD-Backend-success?style=for-the-badge&logo=githubactions)
![CI/CD Frontend](https://img.shields.io/badge/CI%2FCD-Frontend-success?style=for-the-badge&logo=githubactions)
![Cloudflare](https://img.shields.io/badge/Deployed_on-Cloudflare-F38020?style=for-the-badge&logo=cloudflare)
![Python](https://img.shields.io/badge/Backend-Python_3.11-3776AB?style=for-the-badge&logo=python)

> Plataforma web ágil y serverless para el registro y monitoreo de especies bioindicadoras.

EcoTracker es un proyecto diseñado no solo para el monitoreo ecológico, sino como una **prueba de concepto integral** que demuestra el dominio de arquitecturas modernas, Infraestructura como Código (IaC), Integración y Despliegue Continuos (CI/CD) y Observabilidad (APM) en el Edge.

---

## Arquitectura y Tecnologías

El proyecto se despliega al 100% en la red global de Cloudflare, eliminando la necesidad de servidores tradicionales.

* **Frontend:** HTML5, CSS3 y Vanilla JS (Alojado en *Cloudflare Pages*).
* **Backend:** API nativa en Python usando Pyodide (Alojado en *Cloudflare Workers*).
* **Base de Datos:** *Cloudflare D1* (SQL Serverless).
* **Infraestructura como Código (IaC):** *Terraform* (Creación de BD y recursos base).
* **Contenedores y Pruebas:** *Docker* (Construcción de imágenes y validación en CI).
* **CI/CD:** *GitHub Actions* con despliegues automatizados a entornos de Dev/Prod.

---

## Estructura del Repositorio

El proyecto sigue una estructura de monorepo para facilitar la visibilidad y el despliegue concurrente:

```text
/
├── .github/workflows/      # Pipelines de CI/CD (Backend y Frontend)
├── docs/                   # Wiki y diagramas de arquitectura (Archivos .MD)
├── ecotracker-backend/     # Código fuente del API en Python + Wrangler CLI
├── ecotracker-frontend/    # Código estático de la Interfaz + Wrangler CLI
├── ecotracker-infra/       # Código de Terraform para aprovisionar Cloudflare
└── docker-compose.yml      # Orquestación para pruebas locales
