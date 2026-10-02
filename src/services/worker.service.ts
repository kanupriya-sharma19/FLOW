/*
  FLOW Worker — Retry Support

  Job lifecycle:

      PENDING
         ↓
      Scheduler
         ↓
      QUEUED
         ↓
      Worker picks the job
         ↓
      RUNNING
         ↓
      Execute job.command
         ↓
      ┌───────────────┴───────────────┐
      ↓                               ↓
  command succeeds               command fails
      ↓                               ↓
  COMPLETED                    attempts < max_attempts?
                                      │
                               ┌──────┴──────┐
                               ↓             ↓
                              YES            NO
                               ↓             ↓
                            QUEUED         FAILED
                               │
                               ↓
                         Try the job again

  `attempts` represents how many times the job
  has actually been executed.

  Example:

    max_attempts = 3

    Attempt 1 → FAILED → QUEUED
    Attempt 2 → FAILED → QUEUED
    Attempt 3 → FAILED → FAILED permanently

  PostgreSQL is currently being used as both:
    1. Persistent storage for jobs
    2. Temporary queue for this POC

  Later, Redis/BullMQ can replace the database polling
  mechanism for distributing jobs to workers.
*/

import { exec } from "child_process";
import { promisify } from "util";

import { pool } from "../db.js";

const execAsync = promisify(exec);

export const processJob = async () => {
  try {
    // --------------------------------------------------
    // 1. Find one QUEUED job
    //
    // Higher priority jobs are processed first.
    // If priorities are equal, older jobs are processed first.
    // --------------------------------------------------

    const result = await pool.query(
      `
      SELECT *
      FROM jobs
      WHERE status = 'QUEUED'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
      `,
    );

    // No queued job available right now.
    if (result.rows.length === 0) {
      return;
    }

    const job = result.rows[0];
    // --------------------------------------------------
    // 2. Mark the job as RUNNING
    //
    // Increment attempts because we are starting an
    // actual execution attempt.
    //
    // RETURNING * gives us the updated job, including
    // the new attempts value.
    // --------------------------------------------------

    const runningResult = await pool.query(
      `
  UPDATE jobs
  SET
    status = 'RUNNING',
    attempts = attempts + 1,
    started_at = NOW(),
    updated_at = NOW()
  WHERE id = $1
  RETURNING *
  `,
      [job.id],
    );

    const runningJob = runningResult.rows[0];

    console.log(
      `Running job: ${runningJob.name} (attempt ${runningJob.attempts}/${runningJob.max_attempts})`,
    );

    // Record that this execution attempt started.
    await pool.query(
      `
  INSERT INTO job_logs (job_id, event, message)
  VALUES ($1, $2, $3)
  `,
      [runningJob.id, "STARTED", `Attempt ${runningJob.attempts} started`],
    );

    // --------------------------------------------------
    // 3. Execute the actual command
    //
    // Example:
    //
    // job.command = "echo Hello FLOW"
    //
    // The operating system actually executes the command.
    // --------------------------------------------------

    try {
      const { stdout, stderr } = await execAsync(runningJob.command);

      console.log("stdout:", stdout);

      if (stderr) {
        console.log("stderr:", stderr);
      }

      // ------------------------------------------------
      // 4. Command succeeded
      //
      // RUNNING → COMPLETED
      // ------------------------------------------------

      await pool.query(
        `
  UPDATE jobs
  SET
    status = 'COMPLETED',
    completed_at = NOW(),
    error = NULL,
    updated_at = NOW()
  WHERE id = $1
  `,
        [job.id],
      );

      await pool.query(
        `
  INSERT INTO job_logs (job_id, event, message)
  VALUES ($1, $2, $3)
  `,
        [
          job.id,
          "COMPLETED",
          `Job completed successfully on attempt ${runningJob.attempts}`,
        ],
      );

      console.log(`Job completed: ${job.name}`);
    } catch (error) {
      // ------------------------------------------------
      // 5. Command failed
      //
      // The operating system reported an execution error.
      // Now we decide whether the job should be retried.
      // ------------------------------------------------

      const message = error instanceof Error ? error.message : String(error);
      const currentAttempt = runningJob.attempts;

      await pool.query(
        `
  INSERT INTO job_logs (job_id, event, message)
  VALUES ($1, $2, $3)
  `,
        [job.id, "FAILED", `Attempt ${currentAttempt} failed: ${message}`],
      );

      if (currentAttempt < job.max_attempts) {
        // ----------------------------------------------
        // Retry is still available.
        //
        // RUNNING → QUEUED
        //
        // The scheduler is not involved here.
        // We directly put the job back into QUEUED so
        // the worker can pick it up again.
        // ----------------------------------------------

        await pool.query(
          `
          UPDATE jobs
          SET
            status = 'QUEUED',
            error = $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [message, job.id],
        );
        await pool.query(
          `
  INSERT INTO job_logs (job_id, event, message)
  VALUES ($1, $2, $3)
  `,
          [
            job.id,
            "RETRYING",
            `Retrying job (next attempt: ${currentAttempt + 1}/${job.max_attempts})`,
          ],
        );
        console.log(
          `Job failed: ${job.name}. Retrying (${currentAttempt}/${job.max_attempts})`,
        );
      } else {
        // ----------------------------------------------
        // No retries remaining.
        //
        // RUNNING → FAILED
        // ----------------------------------------------

        await pool.query(
          `
          UPDATE jobs
          SET
            status = 'FAILED',
            error = $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [message, job.id],
        );

        console.error(
          `Job permanently failed: ${job.name} (${currentAttempt}/${job.max_attempts})`,
        );
      }
    }
  } catch (error) {
    // --------------------------------------------------
    // This catches worker/database-level errors.
    //
    // Example:
    // PostgreSQL connection failure
    // SQL error
    // etc.
    // --------------------------------------------------

    console.error("Worker error:", error);
  }
};

export const startWorker = () => {
  console.log("Worker started");

  // Prevent this single worker from processing
  // multiple jobs at the same time.
  let isProcessing = false;

  // Check for queued jobs every 2 seconds.
  setInterval(async () => {
    // If the worker is already processing a job,
    // skip this interval cycle.
    if (isProcessing) {
      return;
    }

    isProcessing = true;

    try {
      await processJob();
    } finally {
      // Allow the worker to pick up another job
      // after the current job finishes.
      isProcessing = false;
    }
  }, 2000);
};
