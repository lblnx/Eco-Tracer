try:
    from js import Response  # type: ignore
except ImportError:
    class Response:
        @staticmethod
        def new(body, status=200, headers=None):
            return {"body": body, "status": status, "headers": headers or {}}

import json

async def on_fetch(request, env):
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }

    try:
        print(f"APM [INFO]: Request recibida: {request.method} {request.url}")

        if request.method == "OPTIONS":
            return Response.new("OK", status=200, headers=cors_headers)

        if request.method == "GET":
            data = {"mensaje": "API EcoTracker funcionando en el Edge", "status": "ok"}
            return Response.new(json.dumps(data), status=200, headers=cors_headers)
        
        if request.method == "POST":
            # Esto detonará nuestra excepción a propósito para la presentación
            raise Exception("Fallo de conexión simulado con D1 Database")

        return Response.new(json.dumps({"error": "Method Not Allowed"}), status=405, headers=cors_headers)

    except Exception as e:
          
        print(f"APM [ERROR]: {str(e)}")
        return Response.new(
            json.dumps({"error": str(e)}), 
            status=500, 
            headers=cors_headers
        )