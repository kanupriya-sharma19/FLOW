import type { JobStatus } from "../../types/job";

interface JobStatusBadgeProps {
  status: JobStatus;
}

const JobStatusBadge = ({ status }: JobStatusBadgeProps) => {
  const styles: Record<JobStatus, string> = {
    PENDING: "bg-gray-100 text-gray-700",
    QUEUED: "bg-yellow-100 text-yellow-700",
    RUNNING: "bg-blue-100 text-blue-700",
    COMPLETED: "bg-green-100 text-green-700",
    FAILED: "bg-red-100 text-red-700",
    CANCELLED: "bg-gray-100 text-gray-500",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
};

export default JobStatusBadge;
