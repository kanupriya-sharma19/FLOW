import { pool } from "../db.js";
import { getBullMQExecutionId, jobQueue } from "../queues/job.queue.js";

export const queuePendingJobs = async () => {
  const result = await pool.query(
    `
    UPDATE jobs
    SET
      status = 'QUEUED',
      updated_at = NOW()
    WHERE status = 'PENDING'
    AND (
        schedule_type = 'IMMEDIATE'

        OR

        (
            schedule_type = 'ONCE'
            AND scheduled_at <= NOW()
        )

        OR

        (
            schedule_type = 'RECURRING'
            AND next_run_at <= NOW()
        )
    )
    RETURNING *
    `,
  );

  const queuedResult = await pool.query(
    `
    SELECT *
    FROM jobs
    WHERE status = 'QUEUED'
      AND (
        schedule_type = 'IMMEDIATE'
        OR (schedule_type = 'ONCE' AND scheduled_at <= NOW())
        OR (schedule_type = 'RECURRING' AND next_run_at <= NOW())
      )
    `,
  );

  const jobsById = new Map(
    [...result.rows, ...queuedResult.rows].map((job) => [job.id, job]),
  );
  const jobs = [...jobsById.values()];

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;

    try {
      const bullmqJobId = getBullMQExecutionId(job);
      const existingBullJob = await jobQueue.getJob(bullmqJobId);

      if (existingBullJob) {
        const state = await existingBullJob.getState();

        if (state === "completed") {
          await existingBullJob.remove();
        } else if (state === "failed") {
          await pool.query(
            `
            UPDATE jobs
            SET status = 'FAILED',
                error = $2,
                updated_at = NOW()
            WHERE id = $1
              AND status = 'QUEUED'
            `,
            [job.id, existingBullJob.failedReason || "BullMQ job failed"],
          );

          continue;
        } else {
          continue;
        }
      }

      const bullJob = await jobQueue.add(
        "execute-job", //name/type of the individual BullMQ job.
        {
          jobId: job.id, //This is data that we're giving to the worker.
        },
        {
          jobId: bullmqJobId, //Unique per recurring execution; stable across scheduler retries.
          priority: -job.priority,
          // -----------------------------------------------
          // BullMQ retry configuration
          //
          // max_attempts is stored in PostgreSQL, so the
          // queue gets the same retry limit.
          // -----------------------------------------------

          attempts: job.max_attempts,

          // Wait 2 seconds before retrying.
          backoff: {
            type: "fixed",
            delay: 2000,
          },
          removeOnComplete: true,
        },
      );
    } catch (error) {
      const notEnqueuedJobIds = jobs
        .slice(index)
        .map((pendingJob) => pendingJob.id);

      await pool.query(
        `
        UPDATE jobs
        SET status = 'PENDING', updated_at = NOW()
        WHERE id = ANY($1::uuid[])
          AND status = 'QUEUED'
        `,
        [notEnqueuedJobIds],
      );

      throw error;
    }

    await pool.query(
      `
      INSERT INTO job_logs (job_id, event, message)
      VALUES ($1, $2, $3)
      `,
      [job.id, "QUEUED", "Job queued in BullMQ"],
    );
  }

  return result.rows;
};

export const startScheduler = () => {
  console.log("Scheduler started");

  setInterval(async () => {
    try {
      const jobs = await queuePendingJobs();

      if (jobs.length > 0) {
        console.log(`PostgreSQL marked ${jobs.length} job(s) QUEUED`);
      }
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  }, 5000);
};
