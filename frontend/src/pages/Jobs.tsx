import { Plus } from "lucide-react";
import JobStatusBadge from "../components/jobs/JobStatusBadge";
import JobForm from "../components/jobs/JobForm";
import { useJobs } from "../hooks/useJobs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const Jobs = () => {
  const { jobs, loading, error, refetch } = useJobs();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const navigate = useNavigate();

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesSearch = job.name
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "ALL" || job.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [jobs, search, statusFilter]);
  const handleJobCreated = async () => {
    setShowCreateForm(false);
    await refetch();
  };

  if (loading) {
    return <p>Loading jobs...</p>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage and monitor scheduled jobs.
          </p>
        </div>

        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Plus size={18} />
          Create Job
        </button>
      </div>

      <div className="mb-4 flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs..."
          className="w-full max-w-sm rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
        >
          <option value="ALL">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="QUEUED">Queued</option>
          <option value="RUNNING">Running</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Jobs table */}
      {filteredJobs.length === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center">
          <p className="text-gray-500">
            {jobs.length === 0
              ? "No jobs found."
              : "No jobs match your filters."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Type</th>
                <th className="px-6 py-4 font-medium">Schedule</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Priority</th>
              </tr>
            </thead>

            <tbody>
              {filteredJobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => navigate(`/jobs/${job.id}`)}
                  className="cursor-pointer border-b last:border-0 hover:bg-gray-50"
                >
                  <td className="px-6 py-4 font-medium">{job.name}</td>

                  <td className="px-6 py-4">{job.job_type}</td>

                  <td className="px-6 py-4">{job.schedule_type}</td>

                  <td className="px-6 py-4">
                    <JobStatusBadge status={job.status} />
                  </td>

                  <td className="px-6 py-4">{job.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Job Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
            <JobForm
              onSuccess={handleJobCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Jobs;
