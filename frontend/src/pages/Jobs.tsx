import { CalendarClock, Code2, FileCode2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import JobForm from "../components/jobs/JobForm";
import JobStatusBadge from "../components/jobs/JobStatusBadge";
import { useJobs } from "../hooks/useJobs";

const formatCreated = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const Jobs = () => {
  const { jobs, loading, error, refetch } = useJobs();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const navigate = useNavigate();

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        const matchesSearch = job.name.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = statusFilter === "ALL" || job.status === statusFilter;
        return matchesSearch && matchesStatus;
      }),
    [jobs, search, statusFilter],
  );

  const handleJobCreated = async () => {
    setShowCreateForm(false);
    await refetch();
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-description">
            Schedule work, inspect execution state, and manage retries.
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={() => setShowCreateForm(true)}
          type="button"
        >
          <Plus size={16} /> Create job
        </button>
      </div>

      <div className="toolbar jobs-toolbar">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search jobs..."
            aria-label="Search jobs"
            className="field-control"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter by status"
          className="field-control"
          style={{ width: 155 }}
        >
          <option value="ALL">All status</option>
          <option value="PENDING">Pending</option>
          <option value="QUEUED">Queued</option>
          <option value="RUNNING">Running</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <span className="secondary-cell jobs-result-count">
          {filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"}
        </span>
      </div>

      <section className="surface table-shell jobs-table-shell" aria-label="Jobs">
        {loading ? (
          <div className="loading-state feedback-state">Loading jobs…</div>
        ) : error ? (
          <div className="feedback-state">
            <div className="feedback-error">{error}</div>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><CalendarClock size={17} /></span>
            <div className="empty-title">
              {jobs.length === 0 ? "No jobs created yet" : "No matching jobs"}
            </div>
            <div className="empty-description">
              {jobs.length === 0
                ? "Create a job to start scheduling and tracking execution."
                : "Try another name or status filter."}
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Type</th>
                  <th>Schedule</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Attempts</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const Icon = job.job_type === "COMMAND" ? Code2 : FileCode2;
                  return (
                    <tr
                      key={job.id}
                      className="table-row"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/jobs/${job.id}`);
                        }
                      }}
                      tabIndex={0}
                      role="link"
                      aria-label={`View job ${job.name}`}
                    >
                      <td>
                        <div className="table-job">
                          <span className={`job-type-icon job-type-icon-${job.job_type.toLowerCase()}`}>
                            <Icon size={14} strokeWidth={1.8} />
                          </span>
                          <span className="job-cell-name">{job.name}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`jobs-type-value jobs-type-${job.job_type.toLowerCase()}`}>
                          {job.job_type === "COMMAND" ? "Command" : "File"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`jobs-schedule-value jobs-schedule-${job.schedule_type.toLowerCase()}`}
                          title={job.cron_expression || undefined}
                        >
                          <CalendarClock size={14} strokeWidth={1.8} aria-hidden="true" />
                          {job.schedule_type === "RECURRING"
                            ? job.cron_expression || "Recurring"
                            : job.schedule_type === "ONCE" && job.scheduled_at
                              ? new Date(job.scheduled_at).toLocaleString("en-IN", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })
                              : "Immediate"}
                        </span>
                      </td>
                      <td><JobStatusBadge status={job.status} /></td>
                      <td><span className="jobs-priority-value">{job.priority}</span></td>
                      <td>
                        <span className="jobs-attempts-value">
                          {job.attempts} / {job.max_attempts}
                        </span>
                      </td>
                      <td><span className="jobs-created-value">{formatCreated(job.created_at)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreateForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreateForm(false);
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-job-title"
          >
            <JobForm
              onSuccess={handleJobCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default Jobs;
