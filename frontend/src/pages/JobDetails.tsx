import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getJob,
  cancelJob,
  deleteJob,
  getJobExecutions,
  getJobLogs,
} from "../services/api";
import JobStatusBadge from "../components/jobs/JobStatusBadge";
import type { Job, JobExecution, JobLog } from "../types/job";
import {
  ArrowLeft,
  Trash2,
  XCircle,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Play,
  UserCheck,
  FilePlus2,
} from "lucide-react";

const formatTimestamp = (timestamp: string | null) => {
  if (!timestamp) return "—";

  return new Date(timestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  });
};

const JobDetails = () => {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [executions, setExecutions] = useState<JobExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchJob = async () => {
      if (!id) return;

      try {
        const data = await getJob(id);
        setJob(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchJob();
  }, [id]);

  const handleCancel = async () => {
    if (!id) return;

    try {
      const updatedJob = await cancelJob(id);
      setJob(updatedJob);
    } catch (error) {
      console.error(error);
    }
  };

  const handleDelete = async () => {
    if (!id) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this job?",
    );

    if (!confirmed) return;

    try {
      await deleteJob(id);
      navigate("/jobs");
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const fetchJobData = async () => {
      if (!id) return;

      try {
        const [jobData, executionData, logData] = await Promise.all([
          getJob(id),
          getJobExecutions(id),
          getJobLogs(id),
        ]);

        setJob(jobData);
        setExecutions(executionData);
        setLogs(logData);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchJobData();
  }, [id]);

  if (loading) {
    return <p>Loading job...</p>;
  }

  if (!job) {
    return <p>Job not found.</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{job.name}</h1>

        <div className="mt-2">
          <JobStatusBadge status={job.status} />
        </div>
      </div>
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => navigate("/jobs")}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to Jobs
        </button>

        {["PENDING", "QUEUED"].includes(job.status) && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <XCircle size={16} />
            Cancel Job
          </button>
        )}
        <button
          onClick={handleDelete}
          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <Trash2 size={16} />
          Delete Job
        </button>
      </div>

      <div className="rounded-xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Job Details</h2>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-500">Type</p>
            <p className="mt-1">{job.job_type}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Schedule</p>
            <p className="mt-1">{job.schedule_type}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Priority</p>
            <p className="mt-1">{job.priority}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Attempts</p>
            <p className="mt-1">
              {job.attempts} / {job.max_attempts}
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Runtime</p>
            <p className="mt-1">{job.runtime || "N/A"}</p>
          </div>
        </div>

        {job.command && (
          <div className="mt-6">
            <p className="text-sm text-gray-500">Command</p>
            <pre className="mt-2 rounded-lg bg-gray-100 p-4 text-sm">
              {job.command}
            </pre>
          </div>
        )}

        {job.file_path && (
          <div className="mt-6">
            <p className="text-sm text-gray-500">File</p>
            <p className="mt-1">{job.file_path}</p>
          </div>
        )}
      </div>
      <div className="mt-6 rounded-xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Execution History</h2>

        {executions.length === 0 ? (
          <p className="text-sm text-gray-500">No executions yet.</p>
        ) : (
          <div className="space-y-3">
            {executions.map((execution) => (
              <div key={execution.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Attempt {execution.attempt}</p>

                    <p className="text-sm text-gray-500">
                      Worker: {execution.worker_id || "Unknown"}
                    </p>
                  </div>

                  <span className="text-sm font-medium">
                    {execution.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Started</p>
                    <p>{formatTimestamp(execution.started_at)}</p>
                  </div>

                  <div>
                    <p className="text-gray-500">Completed</p>
                    <p>{formatTimestamp(execution.completed_at)}</p>
                  </div>

                  <div>
                    <p className="text-gray-500">Exit Code</p>
                    <p>{execution.exit_code ?? "—"}</p>
                  </div>
                </div>

                {execution.error && (
                  <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    {execution.error}
                  </div>
                )}
                {execution.stdout && (
                  <div className="mt-4">
                    <p className="mb-1 text-sm text-gray-500">stdout</p>
                    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-sm text-white">
                      {execution.stdout}
                    </pre>
                  </div>
                )}

                {execution.stderr && (
                  <div className="mt-4">
                    <p className="mb-1 text-sm text-gray-500">stderr</p>
                    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-sm text-white">
                      {execution.stderr}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-6 rounded-xl border bg-white p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Activity</h2>
          <p className="mt-1 text-sm text-gray-500">
            Job lifecycle and execution events
          </p>
        </div>

        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">No activity yet.</p>
        ) : (
          <div>
            {logs.map((log, index) => {
              const isLast = index === logs.length - 1;

              const eventConfig: Record<
                string,
                {
                  color: string;
                  bg: string;
                  icon: React.ReactNode;
                }
              > = {
                CREATED: {
                  color: "text-gray-600",
                  bg: "bg-gray-100",
                  icon: <FilePlus2 size={15} />,
                },
                QUEUED: {
                  color: "text-yellow-600",
                  bg: "bg-yellow-100",
                  icon: <Clock3 size={15} />,
                },
                WORKER_ASSIGNED: {
                  color: "text-purple-600",
                  bg: "bg-purple-100",
                  icon: <UserCheck size={15} />,
                },
                STARTED: {
                  color: "text-blue-600",
                  bg: "bg-blue-100",
                  icon: <Play size={15} />,
                },
                COMPLETED: {
                  color: "text-green-600",
                  bg: "bg-green-100",
                  icon: <CheckCircle2 size={15} />,
                },
                FAILED: {
                  color: "text-red-600",
                  bg: "bg-red-100",
                  icon: <CircleAlert size={15} />,
                },
                CANCELLED: {
                  color: "text-gray-500",
                  bg: "bg-gray-100",
                  icon: <XCircle size={15} />,
                },
              };

              const config = eventConfig[log.event] ?? {
                color: "text-gray-600",
                bg: "bg-gray-100",
                icon: <Clock3 size={15} />,
              };

              return (
                <div key={log.id} className="relative flex gap-4">
                  {/* Connecting line */}
                  {!isLast && (
                    <div className="absolute left-5 top-10 bottom-0 w-px bg-gray-200" />
                  )}

                  {/* Event icon */}
                  <div
                    className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.bg} ${config.color}`}
                  >
                    {config.icon}
                  </div>

                  {/* Event content */}
                  <div className={`flex-1 ${isLast ? "" : "pb-7"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className={`text-sm font-semibold ${config.color}`}>
                          {log.event}
                        </p>

                        {log.message && (
                          <p className="mt-1 text-sm leading-5 text-gray-600">
                            {log.message}
                          </p>
                        )}
                      </div>

                      <span className="shrink-0 text-xs text-gray-400">
                        {formatTimestamp(log.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default JobDetails;
