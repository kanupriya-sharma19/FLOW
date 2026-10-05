import { useState } from "react";
import { createJob } from "../../services/api";

type JobType = "COMMAND" | "FILE";
type Runtime = "PYTHON" | "NODE";
type ScheduleType = "IMMEDIATE" | "ONCE" | "RECURRING";
interface JobFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const JobForm = ({ onSuccess, onCancel }: JobFormProps) => {
  const [name, setName] = useState("");
  const [jobType, setJobType] = useState<JobType>("COMMAND");
  const [command, setCommand] = useState("");
  const [runtime, setRuntime] = useState<Runtime>("PYTHON");
  const [file, setFile] = useState<File | null>(null);

  const [scheduleType, setScheduleType] = useState<ScheduleType>("IMMEDIATE");

  const [scheduledAt, setScheduledAt] = useState("");
  const [cronExpression, setCronExpression] = useState("");

  const [priority, setPriority] = useState(10);
  const [maxAttempts, setMaxAttempts] = useState(3);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);

    try {
      setLoading(true);

      if (jobType === "COMMAND") {
        await createJob({
          name,
          command,
          jobType: "COMMAND",
          scheduleType,
          priority,
          maxAttempts,
          ...(scheduleType === "ONCE" && {
            scheduledAt,
          }),
          ...(scheduleType === "RECURRING" && {
            cronExpression,
          }),
        });
      } else {
        if (!file) {
          setError("Please select a file.");
          return;
        }

        const formData = new FormData();

        formData.append("name", name);
        formData.append("runtime", runtime);
        formData.append("scheduleType", scheduleType);
        formData.append("priority", String(priority));
        formData.append("maxAttempts", String(maxAttempts));
        formData.append("file", file);

        if (scheduleType === "ONCE") {
          formData.append("scheduledAt", scheduledAt);
        }

        if (scheduleType === "RECURRING") {
          formData.append("cronExpression", cronExpression);
        }

        await createJob(formData);
      }

      // Reset form
      setName("");
      setCommand("");
      setFile(null);
      setScheduleType("IMMEDIATE");
      setScheduledAt("");
      setCronExpression("");
      setPriority(10);
      setMaxAttempts(3);

      onSuccess();
    } catch (err) {
      console.error(err);
      setError("Failed to create job.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl rounded-xl border bg-white p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Create Job</h2>

        <p className="mt-1 text-sm text-gray-500">
          Configure and schedule a new job.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Job Name */}
        <div>
          <label className="mb-2 block text-sm font-medium">Job Name</label>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. daily-report"
            required
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-gray-900"
          />
        </div>

        {/* Job Type */}
        <div>
          <label className="mb-2 block text-sm font-medium">Job Type</label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setJobType("COMMAND")}
              className={`rounded-lg border px-4 py-2 text-sm ${
                jobType === "COMMAND"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "bg-white hover:bg-gray-50"
              }`}
            >
              Command
            </button>

            <button
              type="button"
              onClick={() => setJobType("FILE")}
              className={`rounded-lg border px-4 py-2 text-sm ${
                jobType === "FILE"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "bg-white hover:bg-gray-50"
              }`}
            >
              Upload File
            </button>
          </div>
        </div>

        {/* Command */}
        {jobType === "COMMAND" && (
          <div>
            <label className="mb-2 block text-sm font-medium">Command</label>

            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder='e.g. echo "Hello FLOW"'
              rows={3}
              required
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:border-gray-900"
            />
          </div>
        )}

        {/* File */}
        {jobType === "FILE" && (
          <>
            <div>
              <label className="mb-2 block text-sm font-medium">Runtime</label>

              <select
                value={runtime}
                onChange={(e) => setRuntime(e.target.value as Runtime)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-gray-900"
              >
                <option value="PYTHON">Python</option>
                <option value="NODE">Node.js</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">File</label>

              <input
                type="file"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
          </>
        )}

        {/* Schedule */}
        <div>
          <label className="mb-2 block text-sm font-medium">Schedule</label>

          <div className="grid grid-cols-3 gap-2">
            {[
              ["IMMEDIATE", "Immediate"],
              ["ONCE", "One Time"],
              ["RECURRING", "Recurring"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScheduleType(value as ScheduleType)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  scheduleType === value
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "bg-white hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* One-time */}
        {scheduleType === "ONCE" && (
          <div>
            <label className="mb-2 block text-sm font-medium">
              Scheduled At
            </label>

            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
        )}

        {/* Recurring */}
        {scheduleType === "RECURRING" && (
          <div>
            <label className="mb-2 block text-sm font-medium">
              Cron Expression
            </label>

            <input
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="e.g. */5 * * * *"
              required
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:border-gray-900"
            />

            <p className="mt-1 text-xs text-gray-500">
              Enter a valid cron expression.
            </p>
          </div>
        )}

        {/* Priority + Attempts */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Priority</label>

            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              min={0}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Max Attempts
            </label>

            <input
              type="number"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
              min={1}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t pt-6">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Job"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default JobForm;
