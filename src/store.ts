import pg from "pg";
import { randomUUID } from "node:crypto";
import { hash } from "./core.js";
import type { Patch } from "./patch.js";
import type { Usage } from "./provider.js";
export interface Input {
  repository?: string;
  baseRef?: string;
  recipe: string;
  provider: "reference" | "azure" | "ollama";
  goal?: string;
  publish?: boolean;
  configuration?: "A" | "B" | "C";
}
export interface Checkpoint {
  patches: { task: string; patch: Patch }[];
  repairs: number;
  requests: number;
  tokens: number;
  reservedTokens?: number;
  usage: unknown[];
  verification?: unknown;
  commit?: string;
  image?: string;
}
export interface Run {
  id: string;
  input: Input;
  state: string;
  checkpoint: Checkpoint;
  fence: number;
  cancel_requested: boolean;
  created_at: Date;
  lease_owner: string;
  error: string | null;
}
export class Store {
  pool: pg.Pool;
  readonly url: string;
  constructor(
    url = process.env.DATABASE_URL ??
      "postgres://reposhift:reposhift@127.0.0.1:55432/reposhift",
  ) {
    this.url = url;
    this.pool = new pg.Pool({ connectionString: url });
  }
  async init() {
    await this.pool.query(`
 CREATE TABLE IF NOT EXISTS runs (id uuid PRIMARY KEY, key text UNIQUE NOT NULL, request_hash text NOT NULL, input jsonb NOT NULL, state text NOT NULL DEFAULT 'QUEUED', checkpoint jsonb NOT NULL, fence integer NOT NULL DEFAULT 0, cancel_requested boolean NOT NULL DEFAULT false, lease_owner text, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), error text);
 CREATE TABLE IF NOT EXISTS events (id bigserial PRIMARY KEY, run_id uuid REFERENCES runs(id), state text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS artifacts (run_id uuid REFERENCES runs(id), name text, value jsonb, PRIMARY KEY(run_id,name));
 CREATE TABLE IF NOT EXISTS tasks (run_id uuid REFERENCES runs(id), id text, state text, plan jsonb, PRIMARY KEY(run_id,id));
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS run_fence integer NOT NULL DEFAULT 0;
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fence integer NOT NULL DEFAULT 0;
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_owner text;
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_until timestamptz;
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payload jsonb;
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result jsonb;
 ALTER TABLE tasks ADD COLUMN IF NOT EXISTS error text;
 CREATE TABLE IF NOT EXISTS publish_outbox (run_id uuid PRIMARY KEY REFERENCES runs(id), branch text NOT NULL, pr_url text);
 CREATE TABLE IF NOT EXISTS model_calls (id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id), run_fence integer NOT NULL, task_id text, task_fence integer, reserved integer NOT NULL, usage jsonb, created_at timestamptz NOT NULL DEFAULT now());
 `);
  }
  async reserveModelCall(
    runId: string,
    runFence: number,
    tokens: number,
    task?: { id: string; fence: number; owner: string },
  ) {
    if (!Number.isInteger(tokens) || tokens < 1 || tokens > 100000)
      throw new Error("Invalid token reservation");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const parent = (
        await client.query(
          `SELECT id,state FROM runs WHERE id=$1 AND fence=$2 AND lease_until>now() AND NOT cancel_requested AND state IN ('EXECUTE','REPAIR') FOR UPDATE`,
          [runId, runFence],
        )
      ).rows[0];
      if (!parent) throw new Error("Run lease lost or cancelled");
      if (task) {
        const owned = await client.query(
          `SELECT 1 FROM tasks WHERE run_id=$1 AND id=$2 AND run_fence=$3 AND fence=$4 AND lease_owner=$5 AND state='RUNNING' AND lease_until>now()`,
          [runId, task.id, runFence, task.fence, task.owner],
        );
        if (!owned.rowCount) throw new Error("Task lease lost");
      }
      const totals = (
        await client.query(
          `SELECT count(*)::int AS requests,COALESCE(sum(reserved) FILTER (WHERE usage IS NULL),0)::int AS pending,COALESCE(sum((usage->>'input')::int+(usage->>'output')::int) FILTER (WHERE usage IS NOT NULL),0)::int AS spent FROM model_calls WHERE run_id=$1`,
          [runId],
        )
      ).rows[0];
      if (
        totals.requests >= 30 ||
        totals.spent + totals.pending + tokens > 100000
      )
        throw new Error("Model budget exhausted");
      const id = randomUUID();
      await client.query(
        `INSERT INTO model_calls(id,run_id,run_fence,task_id,task_fence,reserved) VALUES($1,$2,$3,$4,$5,$6)`,
        [id, runId, runFence, task?.id ?? null, task?.fence ?? null, tokens],
      );
      await client.query(
        `INSERT INTO events(run_id,state,detail) VALUES($1,'MODEL_RESERVED',$2)`,
        [
          runId,
          JSON.stringify({ request: id, task: task?.id ?? null, tokens }),
        ],
      );
      await client.query("COMMIT");
      return id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async completeModelCall(id: string, usage: Usage) {
    if (
      !Number.isInteger(usage.input) ||
      !Number.isInteger(usage.output) ||
      usage.input < 0 ||
      usage.output < 0 ||
      usage.input + usage.output > 1000000
    )
      throw new Error("Invalid model usage");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = (
        await client.query(`SELECT * FROM model_calls WHERE id=$1`, [id])
      ).rows[0];
      if (!prior) throw new Error("Unknown model reservation");
      await client.query(`SELECT id FROM runs WHERE id=$1 FOR UPDATE`, [
        prior.run_id,
      ]);
      const result = await client.query(
        `UPDATE model_calls SET usage=$2 WHERE id=$1 AND usage IS NULL RETURNING run_id`,
        [id, JSON.stringify(usage)],
      );
      if (!result.rowCount) {
        const same = await client.query(
          `SELECT usage=$2::jsonb AS same FROM model_calls WHERE id=$1`,
          [id, JSON.stringify(usage)],
        );
        if (!same.rows[0].same)
          throw new Error("Model usage already recorded differently");
      }
      if (result.rowCount)
        await client.query(
          `INSERT INTO events(run_id,state,detail) VALUES($1,'MODEL_USAGE',$2)`,
          [
            prior.run_id,
            JSON.stringify({
              request: id,
              input: usage.input,
              output: usage.output,
            }),
          ],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async modelAccounting(runId: string) {
    return (
      await this.pool.query(
        `SELECT count(*)::int AS requests,COALESCE(sum(reserved) FILTER (WHERE usage IS NULL),0)::int AS pending,COALESCE(sum((usage->>'input')::int+(usage->>'output')::int) FILTER (WHERE usage IS NOT NULL),0)::int AS spent,COALESCE(jsonb_agg(usage ORDER BY created_at,id) FILTER (WHERE usage IS NOT NULL),'[]'::jsonb) AS usage FROM model_calls WHERE run_id=$1`,
        [runId],
      )
    ).rows[0];
  }
  async submit(input: Input, key: string) {
    if (!key || key.length > 200) throw new Error("Idempotency key required");
    const id = randomUUID(),
      digest = hash(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
          ),
        ),
      );
    const checkpoint: Checkpoint = {
      patches: [],
      repairs: 0,
      requests: 0,
      tokens: 0,
      usage: [],
    };
    await this.pool.query(
      "INSERT INTO runs(id,key,request_hash,input,checkpoint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO NOTHING",
      [id, key, digest, input, checkpoint],
    );
    const { rows } = await this.pool.query("SELECT * FROM runs WHERE key=$1", [
      key,
    ]);
    if (rows[0].request_hash !== digest)
      throw new Error("Idempotency key conflicts with prior request");
    return rows[0] as Run;
  }
  async get(id: string): Promise<Run | undefined> {
    return (await this.pool.query("SELECT * FROM runs WHERE id=$1", [id]))
      .rows[0];
  }
  async claim(owner: string, id?: string): Promise<Run | undefined> {
    return (
      await this.pool.query(
        `UPDATE runs SET lease_owner=$1,lease_until=now()+interval '60 seconds',fence=fence+1 WHERE id=(SELECT id FROM runs WHERE state NOT IN ('COMPLETE','FAILED','CANCELLED') AND ($2::uuid IS NULL OR id=$2) AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
        [owner, id ?? null],
      )
    ).rows[0];
  }
  async heartbeat(run: Run) {
    const result = await this.pool.query(
      "UPDATE runs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND fence=$2 AND lease_owner=$3 AND lease_until>now() RETURNING cancel_requested",
      [run.id, run.fence, run.lease_owner],
    );
    if (!result.rowCount) throw new Error("Lease lost");
    return result.rows[0].cancel_requested as boolean;
  }
  async save(run: Run, state: string, detail: unknown = {}) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT id FROM runs WHERE id=$1 AND fence=$2 AND lease_owner=$3 AND lease_until>now() AND state NOT IN ('COMPLETE','FAILED','CANCELLED') FOR UPDATE`,
        [run.id, run.fence, run.lease_owner],
      );
      if (!locked.rowCount) throw new Error("Lease lost");
      const accounting = (
        await client.query(
          `SELECT count(*)::int AS requests,COALESCE(sum(reserved) FILTER (WHERE usage IS NULL),0)::int AS pending,COALESCE(sum((usage->>'input')::int+(usage->>'output')::int) FILTER (WHERE usage IS NOT NULL),0)::int AS spent,COALESCE(jsonb_agg(usage ORDER BY created_at,id) FILTER (WHERE usage IS NOT NULL),'[]'::jsonb) AS usage FROM model_calls WHERE run_id=$1`,
          [run.id],
        )
      ).rows[0];
      run.checkpoint = {
        ...run.checkpoint,
        requests: accounting.requests,
        tokens: accounting.spent,
        reservedTokens: accounting.pending,
        usage: accounting.usage,
      };
      const r = await client.query(
        `UPDATE runs SET state=$3,checkpoint=$4,updated_at=now(),error=$5,lease_until=CASE WHEN $3 IN ('COMPLETE','FAILED','CANCELLED') THEN NULL ELSE lease_until END WHERE id=$1 AND fence=$2 AND lease_owner=$6 AND lease_until>now() AND state NOT IN ('COMPLETE','FAILED','CANCELLED') AND (NOT cancel_requested OR $3='CANCELLED') RETURNING id`,
        [run.id, run.fence, state, run.checkpoint, run.error, run.lease_owner],
      );
      if (!r.rowCount) throw new Error("Lease lost or cancelled");
      await client.query(
        "INSERT INTO events(run_id,state,detail) VALUES($1,$2,$3)",
        [run.id, state, detail],
      );
      await client.query("COMMIT");
      run.state = state;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async cancel(id: string) {
    await this.pool.query(
      "UPDATE runs SET cancel_requested=true WHERE id=$1 AND state NOT IN ('COMPLETE','FAILED','CANCELLED')",
      [id],
    );
  }
  async artifact(run: Run, name: string, value: unknown) {
    const result = await this.pool.query(
      `INSERT INTO artifacts(run_id,name,value) SELECT id,$3,$4 FROM runs WHERE id=$1 AND fence=$2 AND lease_owner=$5 AND lease_until>now() AND NOT cancel_requested ON CONFLICT(run_id,name) DO UPDATE SET value=EXCLUDED.value`,
      [run.id, run.fence, name, JSON.stringify(value), run.lease_owner],
    );
    if (!result.rowCount) throw new Error("Lease lost or cancelled");
  }
  async artifacts(id: string) {
    return (
      await this.pool.query(
        "SELECT name,value FROM artifacts WHERE run_id=$1 ORDER BY name",
        [id],
      )
    ).rows;
  }
  async events(id: string) {
    return (
      await this.pool.query(
        "SELECT state,detail,at FROM events WHERE run_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
  }
  async close() {
    await this.pool.end();
  }
}
