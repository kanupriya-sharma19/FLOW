import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FilePlus2,
  Play,
  Trash2,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import JobStatusBadge from "../components/jobs/JobStatusBadge";
import {
  cancelJob,
  deleteJob,
  getJob,
  getJobExecutions,
  getJobLogs,
} from "../services/api";
import type { Job, JobExecution, JobLog } from "../types/job";

const formatTimestamp = (timestamp: string | null) => {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  });
};

const eventStyles: Record<string, { className: string; Icon: typeof Clock3 }> = {
  CREATED: { className: "timeline-created", Icon: FilePlus2 },
  QUEUED: { className: "timeline-queued", Icon: Clock3 },
  WORKER_ASSIGNED: { className: "timeline-assigned", Icon: UserCheck },
  STARTED: { className: "timeline-started", Icon: Play },
  COMPLETED: { className: "timeline-completed", Icon: CheckCircle2 },
  FAILED: { className: "timeline-failed", Icon: CircleAlert },
  CANCELLED: { className: "timeline-cancelled", Icon: XCircle },
};

const executionStatusClass: Record<string, string> = {
  PENDING: "status-pending",
  QUEUED: "status-queued",
  RUNNING: "status-running",
  COMPLETED: "status-completed",
  FAILED: "status-failed",
  CANCELLED: "status-cancelled",
};

const scheduleDescription = (job: Job) => {
  if (job.schedule_type === "RECURRING") {
    return job.cron_expression || "Recurring";
  }
  if (job.schedule_type === "ONCE") {
    return job.scheduled_at ? formatTimestamp(job.scheduled_at) : "One-time";
  }
  return "Immediate";
};

const JobDetails = () => {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [executions, setExecutions] = useState<JobExecution[]>([]);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const fetchJobData = async () => {
      if (!id) {
        setError("Job ID is missing.");
        setLoading(false);
        return;
      }

      try {
        const [jobData, executionData, logData] = await Promise.all([
          getJob(id),
          getJobExecutions(id),
          getJobLogs(id),
        ]);
        if (!active) return;
        setJob(jobData);
        setExecutions(executionData);
        setLogs(logData);
      } catch (fetchError) {
        console.error(fetchError);
        if (active) setError("Failed to load job details.");
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchJobData();
    return () => {
      active = false;
    };
  }, [id]);

  const handleCancel = async () => {
    if (!id) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const updatedJob = await cancelJob(id);
      setJob(updatedJob);
    } catch (cancelError) {
      console.error(cancelError);
      setActionError("Failed to cancel this job.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    const confirmed = window.confirm("Are you sure you want to delete this job?");
    if (!confirmed) return;

    setActionError(null);
    setActionLoading(true);
    try {
      await deleteJob(id);
      navigate("/jobs");
    } catch (deleteError) {
      console.error(deleteError);
      setActionError("Failed to delete this job.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="loading-state">Loading job details…</div>;

  if (error || !job) {
    return (
      <div className="surface">
        <div className="feedback-state">
          <div className="feedback-error">{error || "Job not found."}</div>
          <button className="button" onClick={() => navigate("/jobs")} style={{ marginTop: 14 }}>
            <ArrowLeft size={14} /> Back to jobs
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button className="detail-back" onClick={() => navigate("/jobs")} type="button">
        <ArrowLeft size={15} /> Back to jobs
      </button>

      <div className="page-heading detail-heading">
        <div>
          <div className="detail-title-row">
            <h1 className="page-title">{job.name}</h1>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="detail-meta-line">
            <span>{job.job_type === "COMMAND" ? "Command job" : "File job"}</span>
            <span>Created {formatTimestamp(job.created_at)}</span>
            {job.worker_id && <span>Worker {job.worker_id}</span>}
          </div>
        </div>
        <div className="detail-actions">
          {["PENDING", "QUEUED"].includes(job.status) && (
            <button
              className="button button-danger"
              onClick={handleCancel}
              disabled={actionLoading}
              type="button"
            >
              <X size={14} /> Cancel job
            </button>
          )}
          <button
            className="button"
            onClick={handleDelete}
            disabled={actionLoading}
            type="button"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {actionError && (
        <div className="feedback-error" role="alert" style={{ marginBottom: 15 }}>
          {actionError}
        </div>
      )}

      <div className="detail-layout">
        <div className="detail-column">
          <section className="surface">
            <div className="panel-header">
              <div>
                <h2 className="section-title">Overview</h2>
                <p className="section-subtitle">Configuration and lifecycle metadata</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="metadata-grid">
                <Metadata label="Type" value={job.job_type} />
                <Metadata label="Schedule" value={job.schedule_type} />
                <Metadata label="Scheduled for" value={scheduleDescription(job)} />
                <Metadata label="Runtime" value={job.runtime || "—"} />
                <Metadata label="Priority" value={String(job.priority)} />
                <Metadata label="Attempts" value={`${job.attempts} / ${job.max_attempts}`} />
                <Metadata label="Created" value={formatTimestamp(job.created_at)} />
                <Metadata label="Started" value={formatTimestamp(job.started_at)} />
                <Metadata label="Completed" value={formatTimestamp(job.completed_at)} />
              </div>
            </div>
          </section>

          {(job.command || job.file_path) && (
            <section className="surface">
              <div className="panel-header">
                <div>
                  <h2 className="section-title">{job.command ? "Command" : "File"}</h2>
                  <p className="section-subtitle">Execution source</p>
                </div>
              </div>
              <div className="panel-body">
                <pre className="code-block">{job.command || job.file_path}</pre>
              </div>
            </section>
          )}

          <section className="surface">
            <div className="panel-header">
              <div>
                <h2 className="section-title">Execution history</h2>
                <p className="section-subtitle">
                  {executions.length} {executions.length === 1 ? "attempt" : "attempts"} recorded
                </p>
              </div>
            </div>
            <div className="panel-body">
              {executions.length === 0 ? (
                <div className="empty-description">No executions yet.</div>
              ) : (
                <div className="attempt-list">
                  {executions.map((execution) => (
                    <ExecutionAttempt key={execution.id} execution={execution} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="surface">
          <div className="panel-header">
            <div>
              <h2 className="section-title">Activity</h2>
              <p className="section-subtitle">Job lifecycle events</p>
            </div>
            <span className="secondary-cell">{logs.length} events</span>
          </div>
          <div className="panel-body">
            {logs.length === 0 ? (
              <div className="empty-description">No activity yet.</div>
            ) : (
              <div className="timeline">
                {logs.map((log) => {
                  const config = eventStyles[log.event] || {
                    className: "timeline-created",
                    Icon: Clock3,
                  };
                  const Icon = config.Icon;
                  return (
                    <div className="timeline-item" key={log.id}>
                      <span className="timeline-rail" />
                      <span className={`timeline-icon ${config.className}`}>
                        <Icon size={13} strokeWidth={1.9} />
                      </span>
                      <div>
                        <div className="timeline-title">
                          {log.event.replaceAll("_", " ")}
                        </div>
                        {log.message && (
                          <div className="timeline-description">{log.message}</div>
                        )}
                        <div className="timeline-time">
                          {formatTimestamp(log.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};

const Metadata = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="metadata-label">{label}</div>
    <div className="metadata-value">{value}</div>
  </div>
);

const ExecutionAttempt = ({ execution }: { execution: JobExecution }) => {
  const status = execution.status.toUpperCase();
  const statusClass = executionStatusClass[status] || "status-unknown";

  return (
    <article className="attempt-card">
      <div className="attempt-header">
        <div>
          <div className="attempt-name">Attempt {execution.attempt}</div>
          <div className="attempt-worker">Worker: {execution.worker_id || "Unknown"}</div>
        </div>
        <span className={`status-badge ${statusClass}`}>
          <span className="status-dot" aria-hidden="true" />
          {status}
        </span>
      </div>
      <div className="attempt-content">
        <div className="attempt-meta">
          <Metadata label="Started" value={formatTimestamp(execution.started_at)} />
          <Metadata label="Completed" value={formatTimestamp(execution.completed_at)} />
          <Metadata
            label="Exit code"
            value={execution.exit_code === null ? "—" : String(execution.exit_code)}
          />
        </div>
        {execution.error && <div className="output-error">{execution.error}</div>}
        {execution.stdout && (
          <div>
            <p className="output-label">stdout</p>
            <pre className="code-block">{execution.stdout}</pre>
          </div>
        )}
        {execution.stderr && (
          <div>
            <p className="output-label">stderr</p>
            <pre className="code-block">{execution.stderr}</pre>
          </div>
        )}
      </div>
    </article>
  );
};

export default JobDetails;
