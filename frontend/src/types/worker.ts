export interface Worker {
  worker_id: string;
  status: string;
  last_heartbeat: string | null;
  current_job_id: string | null;
  started_at: string;
  updated_at: string;
}