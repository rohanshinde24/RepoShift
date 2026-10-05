import json
import os
import uuid

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .core import digest

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY, key text UNIQUE NOT NULL, request_hash text NOT NULL,
 input jsonb NOT NULL, state text NOT NULL DEFAULT 'QUEUED', checkpoint jsonb NOT NULL,
 fence integer NOT NULL DEFAULT 0, cancel_requested boolean NOT NULL DEFAULT false,
 lease_owner text, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), error text);
CREATE TABLE IF NOT EXISTS events (
 id bigserial PRIMARY KEY, run_id uuid REFERENCES runs(id), state text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS artifacts (
 run_id uuid REFERENCES runs(id), name text, value jsonb, PRIMARY KEY(run_id,name));
CREATE TABLE IF NOT EXISTS tasks (
 run_id uuid REFERENCES runs(id), id text, state text, plan jsonb,
 run_fence integer NOT NULL DEFAULT 0, fence integer NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0, lease_owner text, lease_until timestamptz,
 payload jsonb, result jsonb, error text, PRIMARY KEY(run_id,id));
CREATE TABLE IF NOT EXISTS publish_outbox (
 run_id uuid PRIMARY KEY REFERENCES runs(id), branch text NOT NULL, pr_url text);
CREATE TABLE IF NOT EXISTS model_calls (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id), run_fence integer NOT NULL,
 task_id text, task_fence integer, reserved integer NOT NULL, usage jsonb,
 created_at timestamptz NOT NULL DEFAULT now());
"""


class Store:
    def __init__(self, url=None):
        self.url = url or os.getenv(
            "DATABASE_URL", "postgres://reposhift:reposhift@127.0.0.1:55432/reposhift"
        )

    def connect(self):
        return psycopg.connect(self.url, row_factory=dict_row)

    def init(self):
        with self.connect() as conn:
            conn.execute(SCHEMA)

    def one(self, sql, params=()):
        with self.connect() as conn:
            return conn.execute(sql, params).fetchone()

    def all(self, sql, params=()):
        with self.connect() as conn:
            return conn.execute(sql, params).fetchall()

    def submit(self, data: dict, key: str):
        if not key or len(key) > 200:
            raise ValueError("Idempotency key required")
        request_hash = digest(json.dumps(data, sort_keys=True, separators=(",", ":")))
        checkpoint = {"patches": [], "repairs": 0, "requests": 0, "tokens": 0, "usage": []}
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO runs(id,key,request_hash,input,checkpoint) VALUES(%s,%s,%s,%s,%s) "
                "ON CONFLICT(key) DO NOTHING",
                (uuid.uuid4(), key, request_hash, Jsonb(data), Jsonb(checkpoint)),
            )
            row = conn.execute("SELECT * FROM runs WHERE key=%s", (key,)).fetchone()
            if row["request_hash"] != request_hash:
                raise ValueError("Idempotency key conflicts with prior request")
            return row

    def get(self, run_id):
        return self.one("SELECT * FROM runs WHERE id=%s", (run_id,))

    def claim(self, owner: str, run_id=None):
        return self.one(
            "UPDATE runs SET lease_owner=%s, lease_until=now()+interval '60 seconds', "
            "fence=fence+1 WHERE id=(SELECT id FROM runs WHERE "
            "state NOT IN ('COMPLETE','FAILED','CANCELLED') AND (%s::uuid IS NULL OR id=%s) "
            "AND (lease_until IS NULL OR lease_until<now()) "
            "ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
            (owner, run_id, run_id),
        )

    def heartbeat(self, run):
        row = self.one(
            "UPDATE runs SET lease_until=now()+interval '60 seconds' "
            "WHERE id=%s AND fence=%s AND lease_owner=%s AND lease_until>now() "
            "RETURNING cancel_requested",
            (run["id"], run["fence"], run["lease_owner"]),
        )
        if not row:
            raise RuntimeError("Run lease lost")
        return row["cancel_requested"]

    def accounting(self, conn, run_id):
        return conn.execute(
            "SELECT count(*)::int AS requests, "
            "COALESCE(sum(reserved) FILTER (WHERE usage IS NULL),0)::int AS pending, "
            "COALESCE(sum((usage->>'input')::int+(usage->>'output')::int) "
            "FILTER (WHERE usage IS NOT NULL),0)::int AS spent, "
            "COALESCE(jsonb_agg(usage ORDER BY created_at,id) "
            "FILTER (WHERE usage IS NOT NULL),'[]'::jsonb) AS usage "
            "FROM model_calls WHERE run_id=%s",
            (run_id,),
        ).fetchone()

    def save(self, run, state: str, detail=None):
        with self.connect() as conn:
            locked = conn.execute(
                "SELECT id FROM runs WHERE id=%s AND fence=%s AND lease_owner=%s "
                "AND lease_until>now() AND state NOT IN ('COMPLETE','FAILED','CANCELLED') FOR UPDATE",
                (run["id"], run["fence"], run["lease_owner"]),
            ).fetchone()
            if not locked:
                raise RuntimeError("Run lease lost")
            usage = self.accounting(conn, run["id"])
            run["checkpoint"].update(
                requests=usage["requests"],
                tokens=usage["spent"],
                reservedTokens=usage["pending"],
                usage=usage["usage"],
            )
            row = conn.execute(
                "UPDATE runs SET state=%s, checkpoint=%s, updated_at=now(), error=%s, "
                "lease_until=CASE WHEN %s IN ('COMPLETE','FAILED','CANCELLED') "
                "THEN NULL ELSE lease_until END WHERE id=%s AND fence=%s "
                "AND lease_owner=%s AND lease_until>now() "
                "AND (NOT cancel_requested OR %s='CANCELLED') RETURNING id",
                (
                    state,
                    Jsonb(run["checkpoint"]),
                    run.get("error"),
                    state,
                    run["id"],
                    run["fence"],
                    run["lease_owner"],
                    state,
                ),
            ).fetchone()
            if not row:
                raise RuntimeError("Run lease lost or cancelled")
            conn.execute(
                "INSERT INTO events(run_id,state,detail) VALUES(%s,%s,%s)",
                (run["id"], state, Jsonb(detail or {})),
            )
            run["state"] = state

    def cancel(self, run_id):
        self.one(
            "UPDATE runs SET cancel_requested=true WHERE id=%s "
            "AND state NOT IN ('COMPLETE','FAILED','CANCELLED') RETURNING id",
            (run_id,),
        )

    def artifact(self, run, name, value):
        row = self.one(
            "INSERT INTO artifacts(run_id,name,value) SELECT id,%s,%s FROM runs "
            "WHERE id=%s AND fence=%s AND lease_owner=%s AND lease_until>now() "
            "AND NOT cancel_requested ON CONFLICT(run_id,name) "
            "DO UPDATE SET value=EXCLUDED.value RETURNING name",
            (name, Jsonb(value), run["id"], run["fence"], run["lease_owner"]),
        )
        if not row:
            raise RuntimeError("Run lease lost or cancelled")

    def artifacts(self, run_id):
        return self.all("SELECT name,value FROM artifacts WHERE run_id=%s ORDER BY name", (run_id,))

    def events(self, run_id):
        return self.all("SELECT state,detail,at FROM events WHERE run_id=%s ORDER BY id", (run_id,))

    def reserve_model(self, run, task, tokens: int):
        if not isinstance(tokens, int) or tokens < 1 or tokens > 100000:
            raise ValueError("Invalid token reservation")
        with self.connect() as conn:
            parent = conn.execute(
                "SELECT id FROM runs WHERE id=%s AND fence=%s AND lease_until>now() "
                "AND NOT cancel_requested AND state IN ('EXECUTE','REPAIR') FOR UPDATE",
                (run["id"], run["fence"]),
            ).fetchone()
            if not parent:
                raise RuntimeError("Run lease lost or cancelled")
            owned = conn.execute(
                "SELECT 1 FROM tasks WHERE run_id=%s AND id=%s AND run_fence=%s "
                "AND fence=%s AND lease_owner=%s AND state='RUNNING' AND lease_until>now()",
                (run["id"], task["id"], run["fence"], task["fence"], task["lease_owner"]),
            ).fetchone()
            if not owned:
                raise RuntimeError("Task lease lost")
            usage = self.accounting(conn, run["id"])
            if usage["requests"] >= 30 or usage["spent"] + usage["pending"] + tokens > 100000:
                raise RuntimeError("Model budget exhausted")
            model_id = uuid.uuid4()
            conn.execute(
                "INSERT INTO model_calls(id,run_id,run_fence,task_id,task_fence,reserved) "
                "VALUES(%s,%s,%s,%s,%s,%s)",
                (model_id, run["id"], run["fence"], task["id"], task["fence"], tokens),
            )
            conn.execute(
                "INSERT INTO events(run_id,state,detail) VALUES(%s,'MODEL_RESERVED',%s)",
                (run["id"], Jsonb({"request": str(model_id), "task": task["id"], "tokens": tokens})),
            )
            return model_id

    def complete_model(self, model_id, usage):
        if any(not isinstance(usage.get(key), int) or usage[key] < 0 for key in ("input", "output")):
            raise ValueError("Invalid model usage")
        with self.connect() as conn:
            prior = conn.execute("SELECT * FROM model_calls WHERE id=%s", (model_id,)).fetchone()
            if not prior:
                raise ValueError("Unknown model reservation")
            conn.execute("SELECT id FROM runs WHERE id=%s FOR UPDATE", (prior["run_id"],))
            if prior["usage"] is not None:
                if prior["usage"] != usage:
                    raise ValueError("Model usage already recorded differently")
                return
            conn.execute("UPDATE model_calls SET usage=%s WHERE id=%s", (Jsonb(usage), model_id))
            conn.execute(
                "INSERT INTO events(run_id,state,detail) VALUES(%s,'MODEL_USAGE',%s)",
                (prior["run_id"], Jsonb({"request": str(model_id), **usage})),
            )

    def enqueue(self, run, task_id, payload):
        row = self.one(
            "INSERT INTO tasks(run_id,id,state,run_fence,payload,attempts,fence) "
            "SELECT id,%s,'QUEUED',fence,%s,0,0 FROM runs WHERE id=%s AND fence=%s "
            "AND state IN ('EXECUTE','REPAIR') AND lease_until>now() AND NOT cancel_requested "
            "ON CONFLICT(run_id,id) DO UPDATE SET state='QUEUED',run_fence=EXCLUDED.run_fence, "
            "payload=EXCLUDED.payload,attempts=0,result=NULL,error=NULL,lease_until=NULL "
            "WHERE tasks.run_fence<>EXCLUDED.run_fence RETURNING id",
            (task_id, Jsonb(payload), run["id"], run["fence"]),
        )
        if not row:
            current = self.task(run["id"], task_id)
            if not current or current["run_fence"] != run["fence"]:
                raise RuntimeError("Coordinator lease lost")

    def task(self, run_id, task_id):
        return self.one("SELECT * FROM tasks WHERE run_id=%s AND id=%s", (run_id, task_id))

    def claim_task(self, run_id, owner, lease_ms=10000):
        with self.connect() as conn:
            parent = conn.execute(
                "SELECT * FROM runs WHERE id=%s AND state IN ('EXECUTE','REPAIR') "
                "AND NOT cancel_requested AND lease_until>now() FOR UPDATE SKIP LOCKED",
                (run_id,),
            ).fetchone()
            if not parent:
                return None
            conn.execute(
                "UPDATE tasks SET state='FAILED',error='Task attempt budget exhausted' "
                "WHERE run_id=%s AND run_fence=%s AND state='RUNNING' "
                "AND lease_until<=now() AND attempts>=3",
                (run_id, parent["fence"]),
            )
            active = conn.execute(
                "SELECT count(*) AS count FROM tasks WHERE run_id=%s AND run_fence=%s "
                "AND state='RUNNING' AND lease_until>now()",
                (run_id, parent["fence"]),
            ).fetchone()["count"]
            if active >= (1 if parent["input"].get("configuration") == "A" else 2):
                return None
            task = conn.execute(
                "UPDATE tasks SET state='RUNNING',lease_owner=%s, "
                "lease_until=now()+(%s * interval '1 millisecond'), "
                "fence=fence+1,attempts=attempts+1 WHERE (run_id,id)=(SELECT run_id,id "
                "FROM tasks WHERE run_id=%s AND run_fence=%s AND attempts<3 "
                "AND (state='QUEUED' OR (state='RUNNING' AND lease_until<=now())) "
                "ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
                (owner, lease_ms, run_id, parent["fence"]),
            ).fetchone()
            if task:
                conn.execute(
                    "INSERT INTO events(run_id,state,detail) VALUES(%s,'TASK_CLAIMED',%s)",
                    (
                        run_id,
                        Jsonb(
                            {
                                "task": task["id"],
                                "worker": owner,
                                "fence": task["fence"],
                                "attempt": task["attempts"],
                            }
                        ),
                    ),
                )
            return task

    def heartbeat_task(self, task, lease_ms=10000):
        row = self.one(
            "UPDATE tasks SET lease_until=now()+(%s * interval '1 millisecond') "
            "WHERE run_id=%s AND id=%s AND fence=%s AND lease_owner=%s "
            "AND state='RUNNING' AND lease_until>now() AND EXISTS(SELECT 1 FROM runs "
            "WHERE id=%s AND fence=%s AND state IN ('EXECUTE','REPAIR') "
            "AND lease_until>now() AND NOT cancel_requested) RETURNING id",
            (
                lease_ms,
                task["run_id"],
                task["id"],
                task["fence"],
                task["lease_owner"],
                task["run_id"],
                task["run_fence"],
            ),
        )
        if not row:
            raise RuntimeError("Task lease lost or cancelled")

    def finish_task(self, task, patch=None, error=None):
        with self.connect() as conn:
            parent = conn.execute(
                "SELECT id FROM runs WHERE id=%s AND fence=%s AND state IN ('EXECUTE','REPAIR') "
                "AND lease_until>now() AND NOT cancel_requested FOR UPDATE",
                (task["run_id"], task["run_fence"]),
            ).fetchone()
            if not parent:
                raise RuntimeError("Coordinator lease lost or cancelled")
            row = conn.execute(
                "UPDATE tasks SET state=%s,result=%s,error=%s,lease_until=NULL "
                "WHERE run_id=%s AND id=%s AND fence=%s AND lease_owner=%s "
                "AND run_fence=%s AND state='RUNNING' AND lease_until>now() RETURNING id",
                (
                    "FAILED" if error else "SUCCEEDED",
                    Jsonb(patch),
                    error,
                    task["run_id"],
                    task["id"],
                    task["fence"],
                    task["lease_owner"],
                    task["run_fence"],
                ),
            ).fetchone()
            if not row:
                raise RuntimeError("Task lease lost")
            conn.execute(
                "INSERT INTO events(run_id,state,detail) VALUES(%s,%s,%s)",
                (
                    task["run_id"],
                    "TASK_FAILED" if error else "TASK_SUCCEEDED",
                    Jsonb({"task": task["id"], "worker": task["lease_owner"], "fence": task["fence"]}),
                ),
            )
