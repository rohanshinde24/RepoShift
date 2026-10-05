import type { Store, Run } from "./store.js";
import type { Patch } from "./patch.js";

export interface TaskPayload {
  recipe: string;
  files: Record<string, string>;
  allowed: string[];
  context?: Record<string, string>;
  diagnostics?: string;
}
export interface QueuedTask {
  run_id: string;
  id: string;
  state: string;
  run_fence: number;
  fence: number;
  lease_owner: string;
  attempts: number;
  payload: TaskPayload;
  result: Patch | null;
  error: string | null;
}
export class TaskQueue {
  constructor(
    readonly store: Store,
    readonly leaseMs = 10000,
  ) {
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000)
      throw new Error("Invalid task lease duration");
  }
  async enqueue(run: Run, id: string, payload: TaskPayload) {
    const result = await this.store.pool.query(
      `INSERT INTO tasks(run_id,id,state,run_fence,payload,attempts,fence)
      SELECT id,$3,'QUEUED',fence,$4,0,0 FROM runs WHERE id=$1 AND fence=$2 AND state IN ('EXECUTE','REPAIR') AND lease_until>now() AND NOT cancel_requested
      ON CONFLICT(run_id,id) DO UPDATE SET state='QUEUED',run_fence=EXCLUDED.run_fence,payload=EXCLUDED.payload,attempts=0,result=NULL,error=NULL,lease_until=NULL
      WHERE tasks.run_fence<>EXCLUDED.run_fence`,
      [run.id, run.fence, id, JSON.stringify(payload)],
    );
    if (!result.rowCount) {
      const current = await this.get(run.id, id);
      if (!current || current.run_fence !== run.fence)
        throw new Error("Coordinator lease lost");
    }
  }
  async get(run: string, id: string): Promise<QueuedTask | undefined> {
    return (
      await this.store.pool.query(
        "SELECT * FROM tasks WHERE run_id=$1 AND id=$2",
        [run, id],
      )
    ).rows[0];
  }
  async claim(runId: string, owner: string): Promise<QueuedTask | undefined> {
    const client = await this.store.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize claims per run so separate workers cannot exceed the shared cap.
      const parent = (
        await client.query(
          `SELECT * FROM runs WHERE id=$1 AND state IN ('EXECUTE','REPAIR') AND NOT cancel_requested AND lease_until>now() FOR UPDATE SKIP LOCKED`,
          [runId],
        )
      ).rows[0] as Run | undefined;
      if (!parent) {
        await client.query("COMMIT");
        return;
      }
      await client.query(
        `UPDATE tasks SET state='FAILED',error='Task attempt budget exhausted' WHERE run_id=$1 AND run_fence=$2 AND state='RUNNING' AND lease_until<=now() AND attempts>=3`,
        [runId, parent.fence],
      );
      const active = Number(
        (
          await client.query(
            `SELECT count(*) FROM tasks WHERE run_id=$1 AND run_fence=$2 AND state='RUNNING' AND lease_until>now()`,
            [runId, parent.fence],
          )
        ).rows[0].count,
      );
      if (active >= (parent.input.configuration === "A" ? 1 : 2)) {
        await client.query("COMMIT");
        return;
      }
      const task = (
        await client.query(
          `UPDATE tasks SET state='RUNNING',lease_owner=$3,lease_until=now()+$4*interval '1 millisecond',fence=fence+1,attempts=attempts+1
        WHERE (run_id,id)=(SELECT run_id,id FROM tasks WHERE run_id=$1 AND run_fence=$2 AND attempts<3 AND (state='QUEUED' OR (state='RUNNING' AND lease_until<=now())) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
          [runId, parent.fence, owner, this.leaseMs],
        )
      ).rows[0] as QueuedTask | undefined;
      if (task)
        await client.query(
          `INSERT INTO events(run_id,state,detail) VALUES($1,'TASK_CLAIMED',$2)`,
          [
            runId,
            JSON.stringify({
              task: task.id,
              worker: owner,
              fence: task.fence,
              attempt: task.attempts,
            }),
          ],
        );
      await client.query("COMMIT");
      return task;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async heartbeat(task: QueuedTask) {
    const result = await this.store.pool.query(
      `UPDATE tasks SET lease_until=now()+$6*interval '1 millisecond' WHERE run_id=$1 AND id=$2 AND fence=$3 AND lease_owner=$4 AND state='RUNNING' AND lease_until>now() AND EXISTS(SELECT 1 FROM runs WHERE id=$1 AND fence=$5 AND state IN ('EXECUTE','REPAIR') AND lease_until>now() AND NOT cancel_requested)`,
      [
        task.run_id,
        task.id,
        task.fence,
        task.lease_owner,
        task.run_fence,
        this.leaseMs,
      ],
    );
    if (!result.rowCount) throw new Error("Task lease lost or cancelled");
  }
  async finish(task: QueuedTask, patch: Patch | null, error?: string) {
    const client = await this.store.pool.connect();
    try {
      await client.query("BEGIN");
      const parent = await client.query(
        `SELECT id FROM runs WHERE id=$1 AND fence=$2 AND state IN ('EXECUTE','REPAIR') AND lease_until>now() AND NOT cancel_requested FOR UPDATE`,
        [task.run_id, task.run_fence],
      );
      if (!parent.rowCount)
        throw new Error("Coordinator lease lost or cancelled");
      const result = await client.query(
        `UPDATE tasks SET state=$6,result=$7,error=$8,lease_until=NULL WHERE run_id=$1 AND id=$2 AND fence=$3 AND lease_owner=$4 AND run_fence=$5 AND state='RUNNING' AND lease_until>now()`,
        [
          task.run_id,
          task.id,
          task.fence,
          task.lease_owner,
          task.run_fence,
          error ? "FAILED" : "SUCCEEDED",
          JSON.stringify(patch),
          error ?? null,
        ],
      );
      if (!result.rowCount) throw new Error("Task lease lost");
      await client.query(
        `INSERT INTO events(run_id,state,detail) VALUES($1,$2,$3)`,
        [
          task.run_id,
          error ? "TASK_FAILED" : "TASK_SUCCEEDED",
          JSON.stringify({
            task: task.id,
            worker: task.lease_owner,
            fence: task.fence,
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
}
