import { pool } from "./db.js";

const createTables = async () => {
  // ---------------------------------------------
  // Jobs table
  //
  // Stores the current state and configuration
  // of every job.
  // ---------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      name VARCHAR(255) NOT NULL,

      -- COMMAND = execute a shell command
      -- FILE    = execute an uploaded file
      job_type VARCHAR(20) NOT NULL DEFAULT 'COMMAND',

      -- Used for COMMAND jobs
      command TEXT,

      -- Used for FILE jobs
      file_path TEXT,

      -- Runtime for uploaded files
      -- Example: PYTHON, NODE, JAVA
      runtime VARCHAR(30),

      priority INT NOT NULL DEFAULT 0,

      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,

      schedule_type VARCHAR(20) NOT NULL DEFAULT 'IMMEDIATE',
      scheduled_at TIMESTAMPTZ,
      cron_expression TEXT,
      next_run_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,

      worker_id VARCHAR(255),
      error TEXT
    );
  `);

  // ---------------------------------------------
  // Jobs migrations
  //
  // Adds new columns to existing databases
  // without deleting existing job data.
  // ---------------------------------------------

  await pool.query(`
    ALTER TABLE jobs
      ADD COLUMN IF NOT EXISTS job_type VARCHAR(20) NOT NULL DEFAULT 'COMMAND',
      ADD COLUMN IF NOT EXISTS file_path TEXT,
      ADD COLUMN IF NOT EXISTS runtime VARCHAR(30);
  `);

  await pool.query(`
    ALTER TABLE jobs
      ALTER COLUMN command DROP NOT NULL;
  `);

  // ---------------------------------------------
  // Convert scheduled_at to TIMESTAMPTZ if an
  // older version of the database used TIMESTAMP.
  // ---------------------------------------------
  
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
  // ---------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      job_id UUID NOT NULL
        REFERENCES jobs(id)
        ON DELETE CASCADE,

      event VARCHAR(50) NOT NULL,

      message TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ---------------------------------------------
  // Workers table
  //
  // Tracks registered workers and their current
  // state.
  // ---------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      worker_id VARCHAR(255) UNIQUE NOT NULL,

      status VARCHAR(50) NOT NULL DEFAULT 'ONLINE',

      last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      current_job_id UUID,

      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ---------------------------------------------
  // Job executions table
  //
  // Stores every individual execution attempt.
  //
  // One job can have many executions because of:
  // - retries
  // - recurring executions
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

      -- Process exit code
      exit_code INT,

      -- Captured process output
      stdout TEXT,

      -- Captured process errors
      stderr TEXT,

      error TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ---------------------------------------------
  // Job execution migrations
  //
  // Adds execution output fields to existing
  // databases without deleting execution history.
  // ---------------------------------------------

  await pool.query(`
    ALTER TABLE job_executions
      ADD COLUMN IF NOT EXISTS exit_code INT,
      ADD COLUMN IF NOT EXISTS stdout TEXT,
      ADD COLUMN IF NOT EXISTS stderr TEXT;
  `);

  // ---------------------------------------------
  // Indexes
  //
  // Frequently used when querying execution
  // history for jobs and workers.
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