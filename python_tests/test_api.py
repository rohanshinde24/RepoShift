import uuid

from fastapi.testclient import TestClient

from reposhift.api import create_app


class FakeStore:
    def __init__(self):
        self.items = {}

    def init(self):
        pass

    def submit(self, data, key):
        if key not in self.items:
            self.items[key] = {"id": uuid.uuid4(), "state": "QUEUED", "input": data}
        return self.items[key]

    def get(self, run_id):
        return next((item for item in self.items.values() if item["id"] == run_id), None)

    def artifacts(self, _run_id):
        return []

    def events(self, _run_id):
        return []

    def cancel(self, _run_id):
        pass


def test_fastapi_auth_validation_and_idempotency():
    token = "local-test-token-long-enough"
    client = TestClient(create_app(FakeStore(), token))
    body = {"recipe": "sdk-options", "provider": "reference"}
    assert client.post("/runs", json=body).status_code == 401
    headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "same"}
    first = client.post("/runs", json=body, headers=headers)
    second = client.post("/runs", json=body, headers=headers)
    assert first.status_code == 202
    assert first.json()["id"] == second.json()["id"]
    assert client.get(f"/runs/{first.json()['id']}", headers=headers).status_code == 200
    assert client.post("/runs", json={**body, "extra": True}, headers=headers).status_code == 422
