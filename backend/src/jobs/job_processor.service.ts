import dotenv from "dotenv";

import { workerId } from "../worker/worker_heartbeat.service.js";
import {
  createJobExecution,
  completeJobExecution,
  failJobExecution,
} from "./job_execution.service.js";
import { executeCommand } from "../executors/command.executor.js";
import { executeScriptFile } from "../executors/script.executor.js";
import { handleJobSuccess, handleJobFailure } from "./job_lifecycle.service.js";
import {
  getJobFromDatabase,
  checkIfCancelled,
  markJobAsRunning,
} from "./job_query.service.js";
import { addJobLog } from "./job_log.service.js";
import type {
  Job,
  ExecutionResult,
  ExecutionError,
} from "../types/job.types.js";

dotenv.config();

const executeJob = (job: Job): Promise<ExecutionResult> => {
  if (job.job_type === "COMMAND") {
    return executeCommand(job);
  }

  if (job.runtime === "PYTHON" || job.runtime === "NODE") {
    return executeScriptFile(job);
  }

  return Promise.reject(new Error(`Unsupported job type: ${job.job_type}`));
};

// ==================================================
// MAIN WORKER FUNCTION
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
