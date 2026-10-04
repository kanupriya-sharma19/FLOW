import { spawn } from "child_process";
import dotenv from "dotenv";

import { pool } from "../db.js";
import { workerId } from "./worker_heartbeat.service.js";
import { calculateNextRun } from "./cron.service.js";

dotenv.config();


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
    [job.id,workerId],
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
// 5. LOG JOB EXECUTION TO DATABASE
// ==================================================

const createJobExecution = async (job: Job) => {
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

const completeJobExecution = async (executionId: string) => {
  await pool.query(
    `
    UPDATE job_executions
    SET
      status = 'COMPLETED',
      completed_at = NOW()
    WHERE id = $1
    `,
    [executionId],
  );
};

const failJobExecution = async (executionId: string, error: string) => {
  await pool.query(
    `
    UPDATE job_executions
    SET
      status = 'FAILED',
      completed_at = NOW(),
      error = $1
    WHERE id = $2
    `,
    [error, executionId],
  );
};

// ==================================================
// 6. EXECUTE COMMAND
// ==================================================
const executeCommand = (job: Job): Promise<void> => {
  return new Promise((resolve, reject) => {
    const child = spawn(job.command, {
      shell: true,
      env: {
        ...process.env,
        FLOW_ATTEMPT: String(job.attempts),
      },
    });

    child.stdout.on("data", (data) => {
      console.log("stdout:", data.toString());
    });

    child.stderr.on("data", (data) => {
      console.log("stderr:", data.toString());
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command exited with code ${code}`));
      }
    });
  });
};

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
  // Update PostgreSQL
  //
  // BullMQ decides whether another attempt happens.
  // -----------------------------------------------

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

  console.log(
    `Job failed: ${job.name}. ` +
      `BullMQ will handle retry if attempts remain.`,
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
    const execution = await createJobExecution(runningJob);

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
      await completeJobExecution(execution.id);

      await handleJobSuccess(runningJob);
    } catch (error) {
      // ---------------------------------------------
      // Failure
      // ---------------------------------------------
      const message = error instanceof Error ? error.message : String(error);

      await failJobExecution(execution.id, message);

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
