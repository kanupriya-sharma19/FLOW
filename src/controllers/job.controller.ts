import type { Request, Response } from "express";
import { pool } from "../db.js";
import { queuePendingJobs } from "../scheduler/scheduler.service.js";
import { getBullMQExecutionId, jobQueue } from "../queues/job.queue.js";
import { calculateNextRun } from "../jobs/job_cron.service.js";
import { addJobLog } from "../jobs/job_log.service.js";

// CREATE
export const createJob = async (req: Request, res: Response) => {
  try {
    const {
      name,
      command,
      runtime,
      priority = 0,
      maxAttempts = 3,
      scheduleType = "IMMEDIATE",
      scheduledAt = null,
      cronExpression = null,
      nextRunAt = null,
    } = req.body;

    const uploadedFile = req.file;

    // --------------------------------------------------
    // Determine job type
    // --------------------------------------------------

    const jobType = uploadedFile ? "FILE" : "COMMAND";

    // --------------------------------------------------
    // Validate basic fields
    // --------------------------------------------------

    if (!name) {
      return res.status(400).json({
        error: "name is required",
      });
    }

    // COMMAND job
    if (jobType === "COMMAND" && !command) {
      return res.status(400).json({
        error: "command is required for COMMAND jobs",
      });
    }

    // FILE job
    if (jobType === "FILE" && !runtime) {
      return res.status(400).json({
        error: "runtime is required for FILE jobs",
      });
    }

    // --------------------------------------------------
    // Validate schedule
    // --------------------------------------------------

    if (
      scheduleType !== "IMMEDIATE" &&
      scheduleType !== "ONCE" &&
      scheduleType !== "RECURRING"
    ) {
      return res.status(400).json({
        error: "Invalid schedule type",
      });
    }

    if (scheduleType === "ONCE" && !scheduledAt) {
      return res.status(400).json({
        error: "scheduledAt is required for ONCE jobs",
      });
    }

    let scheduledAtForDatabase = scheduledAt;

    if (scheduleType === "ONCE") {
      if (typeof scheduledAt !== "string") {
        return res.status(400).json({
          error: "scheduledAt must be an ISO 8601 timestamp",
        });
      }

      const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(scheduledAt);

      const localDateTimePattern =
        /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

      if (!hasTimezone && !localDateTimePattern.test(scheduledAt)) {
        return res.status(400).json({
          error: "scheduledAt must be an ISO 8601 timestamp",
        });
      }

      scheduledAtForDatabase = hasTimezone
        ? scheduledAt
        : `${scheduledAt.replace(" ", "T")}+05:30`;

      if (!Number.isFinite(Date.parse(scheduledAtForDatabase))) {
        return res.status(400).json({
          error: "scheduledAt must be a valid timestamp",
        });
      }
    }

    // --------------------------------------------------
    // Validate recurring schedule
    // --------------------------------------------------

    if (scheduleType === "RECURRING" && !cronExpression) {
      return res.status(400).json({
        error: "cronExpression is required for RECURRING jobs",
      });
    }

    let initialNextRunAt = null;

    if (scheduleType === "RECURRING") {
      try {
        const calculatedNextRunAt = calculateNextRun(
          cronExpression,
          new Date(),
        );

        initialNextRunAt = nextRunAt ?? calculatedNextRunAt;

        if (!Number.isFinite(new Date(initialNextRunAt).getTime())) {
          throw new Error("nextRunAt must be a valid date");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return res.status(400).json({
          error: `Invalid recurring schedule: ${message}`,
        });
      }
    }

    // --------------------------------------------------
    // Insert job
    // --------------------------------------------------

    const result = await pool.query(
      `
      INSERT INTO jobs (
        name,
        job_type,
        command,
        file_path,
        runtime,
        priority,
        max_attempts,
        schedule_type,
        scheduled_at,
        cron_expression,
        next_run_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        name,
        jobType,
        jobType === "COMMAND" ? command : null,
        uploadedFile ? uploadedFile.path : null,
        jobType === "FILE" ? runtime.toUpperCase() : null,
        priority,
        maxAttempts,
        scheduleType,
        scheduledAtForDatabase,
        cronExpression,
        initialNextRunAt,
      ],
    );

    const job = result.rows[0];

    // --------------------------------------------------
    // Create log
    // --------------------------------------------------

    await addJobLog(
      job.id,
      "CREATED",
      jobType === "FILE"
        ? `File job created: ${uploadedFile?.originalname}`
        : "Command job created",
    );

    return res.status(201).json(job);
  } catch (error) {
    console.error("Failed to create job:", error);

    return res.status(500).json({
      error: "Failed to create job",
    });
  }
};

// READ ALL
export const getJobs = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM jobs
      ORDER BY created_at DESC
      `,
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch jobs:", error);

    return res.status(500).json({
      error: "Failed to fetch jobs",
    });
  }
};

// READ ONE
export const getJob = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM jobs
      WHERE id = $1
      `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Job not found",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to fetch job:", error);

    return res.status(500).json({
      error: "Failed to fetch job",
    });
  }
};

// UPDATE
export const updateJob = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { name, command, priority, maxAttempts } = req.body;

    const result = await pool.query(
      `
      UPDATE jobs
      SET
        name = COALESCE($1, name),
        command = COALESCE($2, command),
        priority = COALESCE($3, priority),
        max_attempts = COALESCE($4, max_attempts),
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
      `,
      [name, command, priority, maxAttempts, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Job not found",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update job:", error);

    return res.status(500).json({
      error: "Failed to update job",
    });
  }
};

// DELETE
export const deleteJob = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM jobs
      WHERE id = $1
      RETURNING *
      `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Job not found",
      });
    }

    return res.json({
      message: "Job deleted successfully",
      job: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to delete job:", error);

    return res.status(500).json({
      error: "Failed to delete job",
    });
  }
};

// CANCEL
export const cancelJob = async (
  req: Request<{ id: string }>,
  res: Response,
) => {
  try {
    const { id } = req.params;

    // --------------------------------------------------
    // 1. Mark PostgreSQL job as CANCELLED
    // --------------------------------------------------

    const result = await pool.query(
      `
      UPDATE jobs
      SET
        status = 'CANCELLED',
        updated_at = NOW()
      WHERE id = $1
        AND status IN ('PENDING', 'QUEUED')
      RETURNING *
      `,
      [id],
    );

    await pool.query(
      `
      INSERT INTO job_logs (job_id, event, message)
      VALUES ($1, $2, $3)
      `,
      [id, "CANCELLED", "Job cancelled by user"],
    );

    await addJobLog(id, "CANCELLED", `Job cancelled by user`);

    if (result.rows.length === 0) {
      const jobResult = await pool.query(
        `
        SELECT id, status
        FROM jobs
        WHERE id = $1
        `,
        [id],
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({
          error: "Job not found",
        });
      }

      return res.status(409).json({
        error: `Job cannot be cancelled from status ${jobResult.rows[0].status}`,
      });
    }

    // --------------------------------------------------
    // 2. Remove job from BullMQ
    // --------------------------------------------------

    const cancelledJob = result.rows[0];
    const bullmqJobId = getBullMQExecutionId(cancelledJob);
    const bullJob =
      (await jobQueue.getJob(bullmqJobId)) ??
      (bullmqJobId === id ? null : await jobQueue.getJob(id));

    if (bullJob) {
      await bullJob.remove();

      console.log(`Removed job ${id} from BullMQ`);
    }

    // --------------------------------------------------
    // 3. Return cancelled job
    // --------------------------------------------------

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to cancel job:", error);

    return res.status(500).json({
      error: "Failed to cancel job",
    });
  }
};
// QUEUE PENDING JOBS

export const queueJobs = async (_req: Request, res: Response) => {
  try {
    const jobs = await queuePendingJobs();

    return res.json({
      message: "Pending jobs queued",
      count: jobs.length,
      jobs,
    });
  } catch (error) {
    console.error("Failed to queue jobs:", error);

    return res.status(500).json({
      error: "Failed to queue jobs",
    });
  }
};
