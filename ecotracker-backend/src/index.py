from js import Response

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
            # Nota cómo agrupamos status y headers en un solo diccionario {}
            return Response.new("OK", {"status": 200, "headers": cors_headers})

        if request.method == "GET":
            data = {"mensaje": "API EcoTracker funcionando en el Edge", "status": "ok"}
            return Response.new(json.dumps(data), {"status": 200, "headers": cors_headers})
        
        if request.method == "POST":
            raise Exception("Fallo de conexión simulado con D1 Database")

        return Response.new(json.dumps({"error": "Method Not Allowed"}), {"status": 405, "headers": cors_headers})

    except Exception as e:
        print(f"APM [ERROR CRÍTICO]: {str(e)}")
        return Response.new(
            json.dumps({"error": str(e)}), 
            {"status": 500, "headers": cors_headers}
        )