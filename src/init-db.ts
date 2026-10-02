import { pool } from "./db.js";

const createTables = async () => {
  // ---------------------------------------------
  // Jobs table
  //
  // Stores the current state of every job.
  // ---------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      name VARCHAR(255) NOT NULL,
      command TEXT NOT NULL,

      priority INT NOT NULL DEFAULT 0,

      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,

      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

      started_at TIMESTAMP,
      completed_at TIMESTAMP,

      error TEXT
    );
  `);

  // ---------------------------------------------
  // Job logs table
  //
  // Stores the history of events that happen
  // during a job's lifecycle.
  //
  // One job can have many log entries.
  // ---------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

      event VARCHAR(50) NOT NULL,

      message TEXT,

      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  console.log("Database initialized");

  await pool.end();
};

createTables().catch((error) => {
  console.error("Database initialization failed:", error);
  process.exit(1);
});