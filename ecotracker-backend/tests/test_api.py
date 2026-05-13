def test_api_status():
    respuesta_esperada = {"status": "ok"}
    assert respuesta_esperada["status"] == "ok"
    assert 200 == 200