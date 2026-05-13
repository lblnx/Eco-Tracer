const BACKEND_URL = "https://ecotracker-backend-production.pabloquint-2002.workers.dev"; 

async function testAPI() {
    const resDiv = document.getElementById('resultado');
    resDiv.innerText = "Cargando...";
    try {
        const response = await fetch(BACKEND_URL);
        const data = await response.json();
        resDiv.innerText = JSON.stringify(data, null, 2);
    } catch (error) {
        resDiv.innerText = "Error conectando al backend.";
    }
}

async function testError() {
    const resDiv = document.getElementById('resultado');
    resDiv.innerText = "Generando error...";
    try {
        const response = await fetch(BACKEND_URL, { method: "POST" });
        const data = await response.json();
        resDiv.innerText = JSON.stringify(data, null, 2);
    } catch (error) {
        resDiv.innerText = "Error capturado.";
    }
}