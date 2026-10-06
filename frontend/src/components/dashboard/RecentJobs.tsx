import { useNavigate } from "react-router-dom";
import JobStatusBadge from "../jobs/JobStatusBadge";
import type { Job } from "../../types/job";

interface RecentJobsProps {
  jobs: Job[];
}

const RecentJobs = ({ jobs }: RecentJobsProps) => {
  const navigate = useNavigate();

  const recentJobs = [...jobs]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime(),
    )
    .slice(0, 5);

  return (
    <div className="rounded-xl border bg-white">
      <div className="border-b px-6 py-4">
        <h2 className="font-semibold">Recent Jobs</h2>
      </div>

      {recentJobs.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">
          No jobs yet.
        </div>
      ) : (
        <div>
          {recentJobs.map((job) => (
            <div
              key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              className="flex cursor-pointer items-center justify-between border-b px-6 py-4 last:border-0 hover:bg-gray-50"
            >
              <div>
                <p className="font-medium">{job.name}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {job.job_type} · {job.schedule_type}
                </p>
              </div>

              <JobStatusBadge status={job.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecentJobs;