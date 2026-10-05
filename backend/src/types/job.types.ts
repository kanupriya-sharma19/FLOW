export type JobType = "COMMAND" | "FILE";

export type JobRuntime =
  | "PYTHON"
  | "NODE";
  
export type JobStatus =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ScheduleType =
  | "IMMEDIATE"
  | "ONCE"
  | "RECURRING";

export interface Job {
  id: string;
  name: string;

  job_type: JobType;

  command: string | null;
  file_path: string | null;
  runtime: JobRuntime | null;

  priority: number;

  status: JobStatus;

  attempts: number;
  max_attempts: number;

  schedule_type: ScheduleType;

  scheduled_at: Date | null;
  cron_expression: string | null;
  next_run_at: Date | null;

  created_at: Date;
  updated_at: Date;

  started_at: Date | null;
  completed_at: Date | null;

  worker_id: string | null;
  error: string | null;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecutionError {
  message: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}