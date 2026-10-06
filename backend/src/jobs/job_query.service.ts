import { pool } from "../db.js";
import { workerId } from "../worker/worker_heartbeat.service.js";
import { addJobLog } from "./job_log.service.js";
import type { Job } from "../types/job.types.js";

// ==================================================
// 1. FETCH JOB
// ==================================================

export const getJobFromDatabase = async (jobId: string) => {
  const result = await pool.query(
    `
    SELECT *
    FROM jobs
    WHERE id = $1
    `,
    [jobId],
  );

  if (result.rows.length === 0) {
    throw new Error(`Job ${jobId} not found in PostgreSQL`);
  }

  return result.rows[0];
};

// ==================================================
// 2. CHECK CANCELLATION
// ==================================================

export const checkIfCancelled = async (job: Job): Promise<boolean> => {
  if (job.status !== "CANCELLED") {
    return false;
  }

  console.log(`Job ${job.name} was cancelled. Skipping execution.`);

  await addJobLog(job.id, "CANCELLED", "Job was cancelled before execution");

  return true;
};

// ==================================================
// 3. MARK JOB AS RUNNING
// ==================================================
export const markJobAsRunning = async (job: Job) => {
  const result = await pool.query(
    `
    UPDATE jobs
    SET
      status = 'RUNNING',
      attempts = attempts + 1,
      started_at = NOW(),
      worker_id = $2,
      updated_at = NOW()
    WHERE id = $1
      AND attempts < max_attempts
    RETURNING *
    `,
    [job.id, workerId],
  );

  if (result.rows.length === 0) {
    throw new Error(
      `Job ${job.id} has reached its maximum attempts`,
    );
  }

  return result.rows[0];
};