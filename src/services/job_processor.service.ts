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

type ExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type ExecutionError = {
  message: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

const EXECUTION_TIMEOUT_MS = 30_000;

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

const completeJobExecution = async (
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

const failJobExecution = async (
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

// ==================================================
// 6. EXECUTE COMMAND
//
// Existing command-job behavior.
// ==================================================

const executeCommand = (job: Job): Promise<ExecutionResult> => {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(job.command, {
      shell: true,
      env: {
        ...process.env,
        FLOW_ATTEMPT: String(job.attempts),
      },
    });

    child.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      console.log("stdout:", output);
    });

    child.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      console.log("stderr:", output);
    });

    child.on("error", (error) => {
      reject({
        message: error.message,
        stdout,
        stderr,
        exitCode: null,
      });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
          exitCode: 0,
        });
      } else {
        reject({
          message: `Command exited with code ${code}`,
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      }
    });
  });
};

// ==================================================
// 7. EXECUTE PYTHON FILE
//
// Temporary implementation.
//
// This executes Python directly on the worker machine.
// We will replace this with an isolated container next.
// ==================================================
const executePythonFile = (job: Job): Promise<ExecutionResult> => {
  return new Promise((resolve, reject) => {
    if (!job.file_path) {
      reject(new Error("File job has no file_path"));
      return;
    }

    if (job.runtime !== "PYTHON") {
      reject(new Error(`Unsupported file runtime: ${job.runtime}`));
      return;
    }

    let stdout = "";
    let stderr = "";

    const child = spawn("python3", [job.file_path], {
      shell: false,
      env: {
        ...process.env,
        FLOW_ATTEMPT: String(job.attempts),
      },
    });

    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;

      console.log(
        `Python job ${job.name} exceeded execution timeout of ${EXECUTION_TIMEOUT_MS}ms`,
      );

      child.kill();
    }, EXECUTION_TIMEOUT_MS);

    child.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      console.log("stdout:", output);
    });

    child.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      console.log("stderr:", output);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject({
          message: `Python process exceeded execution timeout of ${
            EXECUTION_TIMEOUT_MS / 1000
          } seconds`,
          stdout,
          stderr,
          exitCode: null,
        });

        return;
      }

      if (code === 0) {
        resolve({
          stdout,
          stderr,
          exitCode: 0,
        });
      } else {
        reject({
          message: `Python process exited with code ${code}`,
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      }
    });
  });
};

// ==================================================
// 8. EXECUTE JOB
//
// Chooses the execution strategy based on job type.
// ==================================================

const executeJob = (job: Job): Promise<ExecutionResult> => {
  if (job.job_type === "COMMAND") {
    return executeCommand(job);
  }

  if (job.job_type === "FILE") {
    return executePythonFile(job);
  }

  return Promise.reject(new Error(`Unsupported job type: ${job.job_type}`));
};

// ==================================================
// 9. HANDLE SUCCESS
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
// 10. HANDLE FAILURE
// ==================================================

const handleJobFailure = async (job: Job, error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
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
// 11. MAIN WORKER FUNCTION
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

    await addJobLog(
      runningJob.id,
      "WORKER_ASSIGNED",
      `Attempt ${runningJob.attempts} assigned to worker ${workerId}`,
    );

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
    // Execute
    // -----------------------------------------------

    try {
      const result = await executeJob(runningJob);

      // ---------------------------------------------
      // Success
      // ---------------------------------------------
      await completeJobExecution(
        execution.id,
        result.stdout,
        result.stderr,
        result.exitCode,
      );

      await handleJobSuccess(runningJob);
    } catch (error) {
      // ---------------------------------------------
      // Failure
      // ---------------------------------------------

      const executionError = error as ExecutionError;

      await failJobExecution(
        execution.id,
        executionError.message,
        executionError.stdout,
        executionError.stderr,
        executionError.exitCode,
      );

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
