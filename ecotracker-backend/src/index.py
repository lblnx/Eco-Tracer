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
    try:
        # 1. APM: Traza de solicitud (Aparecerá en los Logs de Cloudflare)
        print(f"APM [INFO]: Request recibida: {request.method} {request.url}")

        if request.method == "GET":
            # Respuesta exitosa para mostrar que el API funciona
            data = {"mensaje": "API EcoTracker funcionando en el Edge", "status": "ok"}
            return Response.new(
                json.dumps(data), 
                headers={
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                }
            )
        
        if request.method == "POST":
            # 2. APM: Simulación de error crítico para la presentación
            raise Exception("Fallo de conexión simulado con D1 Database")

        return Response.new("Method Not Allowed", status=405)

    except Exception as e:
        # 3. APM: Registro de error en consola
        print(f"APM [ERROR]: {str(e)}")
        return Response.new(
            json.dumps({"error": str(e)}), 
            status=500, 
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )