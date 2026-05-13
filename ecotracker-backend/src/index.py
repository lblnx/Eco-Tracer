try:
    from js import Response  # type: ignore
except ImportError:
    class Response:
        @staticmethod
        def new(body, status=200, headers=None):
            return {
                "body": body,
                "status": status,
                "headers": headers or {}
            }

import json

async def on_fetch(request, env):
    # 1. Definimos los headers CORS base para TODAS las respuestas
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }

    try:
        # APM: Traza de solicitud
        print(f"APM [INFO]: Request recibida: {request.method} {request.url}")

        # 2. Manejo del Preflight de CORS (CRÍTICO para que el navegador no bloquee)
        if request.method == "OPTIONS":
            return Response.new("OK", status=200, headers=cors_headers)

        if request.method == "GET":
            # Respuesta exitosa
            data = {"mensaje": "API EcoTracker funcionando en el Edge", "status": "ok"}
            return Response.new(json.dumps(data), status=200, headers=cors_headers)
        
        if request.method == "POST":
            # APM: Simulación de error crítico para la presentación
            raise Exception("Fallo de conexión simulado con D1 Database")

        # Si mandan otro método (PUT, DELETE, etc)
        return Response.new(json.dumps({"error": "Method Not Allowed"}), status=405, headers=cors_headers)

    except Exception as e:
        # APM: Registro de error en consola
        print(f"APM [ERROR]: {str(e)}")
        return Response.new(
            json.dumps({"error": str(e)}), 
            status=500, 
            headers=cors_headers
        )