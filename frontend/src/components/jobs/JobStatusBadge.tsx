import type { JobStatus } from "../../types/job";

interface JobStatusBadgeProps {
  status: JobStatus;
}

const statusClass: Record<JobStatus, string> = {
  PENDING: "status-pending",
  QUEUED: "status-queued",
  RUNNING: "status-running",
  COMPLETED: "status-completed",
  FAILED: "status-failed",
  CANCELLED: "status-cancelled",
};

const JobStatusBadge = ({ status }: JobStatusBadgeProps) => (
  <span className={`status-badge ${statusClass[status]}`}>
    <span className="status-dot" aria-hidden="true" />
    {status}
  </span>
);

export default JobStatusBadge;
