import { pool } from "../db.js";
import {
  getBullMQExecutionId,
  jobQueue,
} from "../queues/job.queue.js";

const HEARTBEAT_TIMEOUT_SECONDS = 15;
const MONITOR_INTERVAL_MS = 5000;

const recoverWorkerJobs = async (deadWorkerId: string) => {
  const result = await pool.query(
    `
    SELECT
      id,
      name,
      priority,
      max_attempts,
      attempts,
      schedule_type,
      next_run_at
    FROM jobs
    WHERE status = 'RUNNING'
      AND worker_id = $1
    `,
    [deadWorkerId],
  );

  for (const job of result.rows) {
    try {
      const bullmqJobId = getBullMQExecutionId(job);

      // Check whether BullMQ still knows about this job
      const bullJob =
        (await jobQueue.getJob(bullmqJobId)) ??
        (bullmqJobId === job.id ? null : await jobQueue.getJob(job.id));

      if (bullJob) {
        const state = await bullJob.getState();

        console.log(
          `[Worker Monitor] Job ${job.id} found in BullMQ with state: ${state}`,
        );

        /*
         * If BullMQ still has the job, DO NOT add another copy.
         *
         * BullMQ is responsible for recovering a stalled active job.
         */
        continue;
      }

      /*
       * BullMQ no longer has the job.
       *
       * If the database still says RUNNING, we need to
       * put the job back into the queue.
       */

      const remainingAttempts =
        job.max_attempts - job.attempts;

      if (remainingAttempts <= 0) {
        await pool.query(
          `
          UPDATE jobs
          SET
            status = 'FAILED',
            worker_id = NULL,
            error = 'Worker crashed after maximum attempts',
            updated_at = NOW()
          WHERE id = $1
          `,
          [job.id],
        );

        console.log(
          `[Worker Monitor] Job ${job.id} permanently FAILED`,
        );

        continue;
      }

      await jobQueue.add(
        "execute-job",
        {
          jobId: job.id,
        },
        {
          jobId: bullmqJobId,
          priority: -job.priority,
          attempts: remainingAttempts,
          backoff: {
            type: "fixed",
            delay: 2000,
          },
          removeOnComplete: true,
        },
      );

      await pool.query(
        `
        UPDATE jobs
        SET
          status = 'QUEUED',
          worker_id = NULL,
          updated_at = NOW()
        WHERE id = $1
        `,
        [job.id],
      );

      console.log(
        `[Worker Monitor] Requeued crashed job: ${job.id}`,
      );
    } catch (error) {
      console.error(
        `[Worker Monitor] Failed to recover job ${job.id}:`,
        error,
      );
    }
  }
};

export const checkWorkerHealth = async () => {
  try {
    const result = await pool.query(
      `
      UPDATE workers
      SET
        status = 'OFFLINE',
        updated_at = NOW()
      WHERE
        status = 'ONLINE'
        AND last_heartbeat <
          NOW() - INTERVAL '${HEARTBEAT_TIMEOUT_SECONDS} seconds'
      RETURNING worker_id
      `,
    );

    for (const worker of result.rows) {
      console.log(
        `[Worker Monitor] Worker marked OFFLINE: ${worker.worker_id}`,
      );

      // Recover jobs owned by this worker
      await recoverWorkerJobs(worker.worker_id);
    }
  } catch (error) {
    console.error(
      "[Worker Monitor] Error checking worker health:",
      error,
    );
  }
};

export const startWorkerMonitor = () => {
  console.log("Worker Monitor started");

  setInterval(async () => {
    await checkWorkerHealth();
  }, MONITOR_INTERVAL_MS);
};