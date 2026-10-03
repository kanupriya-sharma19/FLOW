import { exec } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";

import { pool } from "../db.js";
import { workerId } from "./worker_heartbeat.service.js";
import { calculateNextRun } from "./cron.service.js";

dotenv.config();

const execAsync = promisify(exec);

// ==================================================
// TYPES
// ==================================================

type Job = any;

// ==================================================
// 1. FETCH JOB
// ==================================================

const getJobFromDatabase = async (jobId: string) => {
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

const checkIfCancelled = async (job: Job): Promise<boolean> => {
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

const markJobAsRunning = async (job: Job) => {
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
    RETURNING *
    `,
    [job.id, workerId],
  );

  return result.rows[0];
};

// ==================================================
// 4. LOG JOB EVENT
// ==================================================

const addJobLog = async (jobId: string, event: string, message: string) => {
  await pool.query(
    `
    INSERT INTO job_logs (job_id, event, message)
    VALUES ($1, $2, $3)
    `,
    [jobId, event, message],
  );
};

// ==================================================
// 5. EXECUTE COMMAND
// ==================================================

const executeCommand = async (job: Job) => {
  const { stdout, stderr } = await execAsync(job.command);

  console.log("stdout:", stdout);

  if (stderr) {
    console.log("stderr:", stderr);
  }
};

// ==================================================
// 6. CALCULATE NEXT RUN
// ==================================================
// ==================================================
// 7. HANDLE SUCCESS
// ==================================================

const handleJobSuccess = async (job: Job) => {
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
// 8. HANDLE FAILURE
// ==================================================

const handleJobFailure = async (job: Job, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  const currentAttempt = job.attempts;

  // -----------------------------------------------
  // Log failure
  // -----------------------------------------------

  await addJobLog(
    job.id,
    "FAILED",
    `Attempt ${currentAttempt} failed: ${message}`,
  );

  // -----------------------------------------------
  // Retry available
  // -----------------------------------------------

  if (currentAttempt < job.max_attempts) {
    await pool.query(
      `
      UPDATE jobs
      SET
        status = 'QUEUED',
        error = $1,
        worker_id = NULL,
        updated_at = NOW()
      WHERE id = $2
      `,
      [message, job.id],
    );

    await addJobLog(
      job.id,
      "RETRYING",
      `BullMQ will retry job. Next attempt: ${
        currentAttempt + 1
      }/${job.max_attempts}`,
    );

    console.log(
      `Job failed: ${job.name}. ` +
        `BullMQ will retry (${currentAttempt + 1}/${job.max_attempts})`,
    );

    return;
  }

  // -----------------------------------------------
  // No retries remaining
  // -----------------------------------------------

  await pool.query(
    `
    UPDATE jobs
    SET
      status = 'FAILED',
      error = $1,
      worker_id = NULL,
      updated_at = NOW()
    WHERE id = $2
    `,
    [message, job.id],
  );

  console.error(
    `Job permanently failed: ${job.name} ` +
      `(${currentAttempt}/${job.max_attempts})`,
  );
};

// ==================================================
// 9. MAIN WORKER FUNCTION
// ==================================================

export const processJob = async (job: any) => {
  try {
    // -----------------------------------------------
    // Get PostgreSQL job
    // -----------------------------------------------

    const jobId = job.data.jobId;

    const dbJob = await getJobFromDatabase(jobId);

    // -----------------------------------------------
    // Check cancellation
    // -----------------------------------------------

    const cancelled = await checkIfCancelled(dbJob);

    if (cancelled) {
      return;
    }

    // -----------------------------------------------
    // Mark RUNNING
    // -----------------------------------------------

    const runningJob = await markJobAsRunning(dbJob);

    console.log(
      `Running job: ${runningJob.name} ` +
        `(attempt ${runningJob.attempts}/${runningJob.max_attempts})`,
    );

    await addJobLog(
      runningJob.id,
      "STARTED",
      `Attempt ${runningJob.attempts} started`,
    );

    // -----------------------------------------------
    // Execute command
    // -----------------------------------------------

    try {
      await executeCommand(runningJob);

      // ---------------------------------------------
      // Success
      // ---------------------------------------------

      await handleJobSuccess(runningJob);
    } catch (error) {
      // ---------------------------------------------
      // Failure
      // ---------------------------------------------

      await handleJobFailure(runningJob, error);

      // IMPORTANT:
      // Tell BullMQ that the job failed so that
      // BullMQ can perform its retry logic.
      throw error;
    }
  } catch (error) {
    console.error("Worker error:", error);

    // BullMQ must receive the error.
    throw error;
  }
};
