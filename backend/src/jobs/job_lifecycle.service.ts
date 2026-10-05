import { pool } from "../db.js";
import { calculateNextRun } from "./job_cron.service.js";
import { addJobLog } from "./job_log.service.js";

import type { Job } from "../types/job.types.js";

// ==================================================
// HANDLE SUCCESS
// =================================================

export const handleJobSuccess = async (job: Job) => {
  // -----------------------------------------------
  // Recurring job
  // -----------------------------------------------

  if (job.schedule_type === "RECURRING" && job.cron_expression) {
    const nextRunAt = calculateNextRun(job.cron_expression, new Date());

    await pool.query(
      `
      UPDATE jobs
      SET
        status = 'PENDING',
        next_run_at = $1,
        attempts = 0,
        error = NULL,
        worker_id = NULL,
        updated_at = NOW()
      WHERE id = $2
      `,
      [nextRunAt, job.id],
    );

    console.log("Recurring job next run:", {
      postgresJobId: job.id,
      cron: job.cron_expression,
      nextRunAt,
    });

    await addJobLog(
      job.id,
      "COMPLETED",
      `Job completed successfully on attempt ${job.attempts}. Next run: ${nextRunAt}`,
    );

    console.log(`Job completed: ${job.name}. ` + `Next run: ${nextRunAt}`);

    return;
  }

  // -----------------------------------------------
  // One-time job
  // -----------------------------------------------

  await pool.query(
    `
    UPDATE jobs
    SET
      status = 'COMPLETED',
      completed_at = NOW(),
      error = NULL,
      worker_id = NULL,
      updated_at = NOW()
    WHERE id = $1
    `,
    [job.id],
  );

  await addJobLog(
    job.id,
    "COMPLETED",
    `Job completed successfully on attempt ${job.attempts}`,
  );

  console.log(`Job completed: ${job.name}`);
};

// ==================================================
// HANDLE FAILURE
// ==================================================

export const handleJobFailure = async (job: Job, error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error
        ? String(error.message)
        : String(error);

  const currentAttempt = job.attempts;

  await addJobLog(
    job.id,
    "FAILED",
    `Attempt ${currentAttempt} failed: ${message}`,
  );

  await pool.query(
    `
    UPDATE jobs
    SET
      error = $1,
      worker_id = NULL,
      updated_at = NOW()
    WHERE id = $2
    `,
    [message, job.id],
  );

  console.log(
    `Job failed: ${job.name}. ` +
      `Attempt ${currentAttempt}/${job.max_attempts}. ` +
      `BullMQ will handle retry if attempts remain.`,
  );
};