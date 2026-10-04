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

      schedule_type VARCHAR(20) NOT NULL DEFAULT 'IMMEDIATE',
      scheduled_at TIMESTAMPTZ,
      cron_expression TEXT,
      next_run_at TIMESTAMPTZ,

      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

      started_at TIMESTAMP,
      completed_at TIMESTAMP,

      worker_id VARCHAR(255),
      error TEXT
    );
  `);

  await pool.query(`
    ALTER TABLE jobs
      ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) NOT NULL DEFAULT 'IMMEDIATE',
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cron_expression TEXT,
      ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'jobs'
          AND column_name = 'scheduled_at'
          AND data_type = 'timestamp without time zone'
      ) THEN
        ALTER TABLE jobs
          ALTER COLUMN scheduled_at TYPE TIMESTAMPTZ
          USING scheduled_at AT TIME ZONE 'Asia/Kolkata';
      END IF;
    END
    $$;
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

  await pool.query(`
   CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ONLINE',
    last_heartbeat TIMESTAMP NOT NULL DEFAULT NOW(),
    current_job_id UUID,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

    // ---------------------------------------------
  // Job executions table
  //
  // Stores every individual execution attempt.
  //
  // One job can have many executions because of
  // retries and recurring runs.
  // ---------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_executions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      job_id UUID NOT NULL
        REFERENCES jobs(id)
        ON DELETE CASCADE,

      worker_id VARCHAR(255),

      attempt INT NOT NULL,

      status VARCHAR(30) NOT NULL DEFAULT 'RUNNING',

      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      completed_at TIMESTAMPTZ,

      error TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ---------------------------------------------
  // Indexes
  //
  // Used frequently when querying execution
  // history for a job or worker.
  // ---------------------------------------------

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_job_executions_job_id
    ON job_executions(job_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_job_executions_worker_id
    ON job_executions(worker_id);
  `);

  console.log("Database initialized");

  await pool.end();
};

createTables().catch((error) => {
  console.error("Database initialization failed:", error);
  process.exit(1);
});
