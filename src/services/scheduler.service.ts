import { pool } from "../db.js";

export const queuePendingJobs = async () => {
  const result = await pool.query(
    `
    UPDATE jobs
    SET
      status = 'QUEUED',
      updated_at = NOW()
    WHERE status = 'PENDING'
    RETURNING *
    `
  );

  // Create a log for every job that was queued.
  for (const job of result.rows) {
    await pool.query(
      `
      INSERT INTO job_logs (job_id, event, message)
      VALUES ($1, $2, $3)
      `,
      [job.id, "QUEUED", "Job queued by scheduler"],
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
        console.log(`Queued ${jobs.length} job(s)`);
      }
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  }, 5000);
};