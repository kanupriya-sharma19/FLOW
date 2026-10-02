import type { Request, Response } from "express";
import { pool } from "../db.js";
import { queuePendingJobs } from "../services/scheduler.service.js";

// CREATE
export const createJob = async (req: Request, res: Response) => {
  try {
    const { name, command, priority = 0, maxAttempts = 3 } = req.body;

    if (!name || !command) {
      return res.status(400).json({
        error: "name and command are required",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO jobs (
        name,
        command,
        priority,
        max_attempts
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [name, command, priority, maxAttempts],
    );
    const job = result.rows[0];
    await pool.query(
      `
  INSERT INTO job_logs (job_id, event, message)
  VALUES ($1, $2, $3)
  `,
      [job.id, "CREATED", "Job created"],
    );
    return res.status(201).json(result.rows[0]);
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
export const cancelJob = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

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
