import hmac
import os
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .core import recipe
from .store import Store


class RunInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipe: str
    provider: str
    repository: str | None = None
    baseRef: str | None = None
    goal: str | None = Field(default=None, max_length=2000)
    publish: bool = False
    configuration: str = "C"


def create_app(store: Store | None = None, token: str | None = None) -> FastAPI:
    store = store or Store()
    token = token if token is not None else os.getenv("REPOSHIFT_API_TOKEN", "")
    if len(token) < 24:
        raise ValueError("REPOSHIFT_API_TOKEN must contain at least 24 characters")
    store.init()
    app = FastAPI(title="RepoShift")

    def authenticated(authorization: str | None = Header(default=None)):
        if not authorization or not hmac.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(status_code=401, detail="Unauthorized")

    @app.post("/runs", status_code=202, dependencies=[Depends(authenticated)])
    def submit(body: RunInput, idempotency_key: str | None = Header(default=None)):
        if not idempotency_key:
            raise HTTPException(status_code=400, detail="Idempotency-Key header required")
        try:
            recipe(body.recipe)
            if body.provider not in {"reference", "ollama", "azure"}:
                raise ValueError("Unsupported provider")
            if body.configuration not in {"A", "B", "C"}:
                raise ValueError("Unsupported configuration")
            from .core import validate_source

            data = body.model_dump(exclude_none=True)
            validate_source(data)
            run = store.submit(data, idempotency_key)
            return {"id": str(run["id"]), "state": run["state"]}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/runs/{run_id}", dependencies=[Depends(authenticated)])
    def status(run_id: UUID):
        run = store.get(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Unknown run")
        return {"run": run, "artifacts": store.artifacts(run_id), "events": store.events(run_id)}

    @app.post("/runs/{run_id}/cancel", dependencies=[Depends(authenticated)])
    def cancel(run_id: UUID):
        if not store.get(run_id):
            raise HTTPException(status_code=404, detail="Unknown run")
        store.cancel(run_id)
        return {"requested": True}

    return app
