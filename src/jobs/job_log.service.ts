import { pool } from "../db.js";

export const addJobLog = async (
  jobId: string,
  event: string,
  message: string,
) => {
  await pool.query(
    `
    INSERT INTO job_logs (job_id, event, message)
    VALUES ($1, $2, $3)
    `,
    [jobId, event, message],
  );
};
