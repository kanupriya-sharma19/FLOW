import { pool } from "../db.js";
import { workerId } from "../worker/worker_heartbeat.service.js";
import type { Job } from "../types/job.types.js";

// ==================================================
//  LOG JOB EXECUTION TO DATABASE
// ==================================================

export const createJobExecution = async (job: Job) => {
  const result = await pool.query(
    `
    INSERT INTO job_executions (
      job_id,
      worker_id,
      attempt,
      status,
      started_at
    )
    VALUES ($1, $2, $3, 'RUNNING', NOW())
    RETURNING *
    `,
    [job.id, workerId, job.attempts],
  );

  return result.rows[0];
};

export const completeJobExecution = async (
  executionId: string,
  stdout = "",
  stderr = "",
  exitCode = 0,
) => {
  await pool.query(
    `
    UPDATE job_executions
    SET
      status = 'COMPLETED',
      completed_at = NOW(),
      stdout = $1,
      stderr = $2,
      exit_code = $3
    WHERE id = $4
    `,
    [stdout, stderr, exitCode, executionId],
  );
};

export const failJobExecution = async (
  executionId: string,
  error: string,
  stdout = "",
  stderr = "",
  exitCode: number | null = null,
) => {
  await pool.query(
    `
    UPDATE job_executions
    SET
      status = 'FAILED',
      completed_at = NOW(),
      error = $1,
      stdout = $2,
      stderr = $3,
      exit_code = $4
    WHERE id = $5
    `,
    [error, stdout, stderr, exitCode, executionId],
  );
};
