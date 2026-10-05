export type JobStatus =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type JobType = "COMMAND" | "FILE";

export type ScheduleType = "IMMEDIATE" | "ONCE" | "RECURRING";

export type Runtime = "PYTHON" | "NODE";

export interface Job {
  id: string;
  name: string;
  job_type: JobType;
  command: string | null;
  file_path: string | null;
  runtime: Runtime | null;
  priority: number;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  schedule_type: ScheduleType;
  scheduled_at: string | null;
  cron_expression: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  worker_id: string | null;
  error: string | null;
}

export interface JobExecution {
  id: string;
  job_id: string;
  worker_id: string | null;
  attempt: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  error: string | null;
}

export interface JobLog {
  id: string;
  job_id: string;
  event: string;
  message: string | null;
  created_at: string;
}