import { X } from "lucide-react";
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (jobType === "FILE" && !file) {
      setError("Please select a file.");
      return;
    }

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
          ...(scheduleType === "ONCE" && { scheduledAt }),
          ...(scheduleType === "RECURRING" && { cronExpression }),
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

        if (scheduleType === "ONCE") formData.append("scheduledAt", scheduledAt);
        if (scheduleType === "RECURRING") {
          formData.append("cronExpression", cronExpression);
        }

        await createJob(formData);
      }

      setName("");
      setCommand("");
      setFile(null);
      setScheduleType("IMMEDIATE");
      setScheduledAt("");
      setCronExpression("");
      setPriority(10);
      setMaxAttempts(3);
      onSuccess();
    } catch (submitError) {
      console.error(submitError);
      setError("Failed to create job.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="modal-header">
        <div>
          <h2 className="page-title" id="create-job-title" style={{ fontSize: 18 }}>
            Create job
          </h2>
          <p className="page-description" style={{ fontSize: 12 }}>
            Configure what to run and when it should execute.
          </p>
        </div>
        <button className="icon-button" onClick={onCancel} type="button" aria-label="Close">
          <X size={17} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="form-body">
        <section className="form-section">
          <div>
            <h3 className="form-section-title">Job configuration</h3>
            <p className="form-section-description">
              Define the task and its executable source.
            </p>
          </div>

          <label className="form-field">
            <span className="field-label">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. daily-report"
              required
              className="field-control"
              autoFocus
            />
          </label>

          <div className="form-field">
            <span className="field-label">Job type</span>
            <div className="segmented-control" role="group" aria-label="Job type">
              {([
                ["COMMAND", "Command"],
                ["FILE", "Upload file"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setJobType(value)}
                  className={`segment-button${jobType === value ? " segment-button-selected" : ""}`}
                  aria-pressed={jobType === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {jobType === "COMMAND" ? (
            <label className="form-field">
              <span className="field-label">Command</span>
              <textarea
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={'e.g. echo "Hello FLOW"'}
                rows={3}
                required
                className="field-control"
                style={{ fontFamily: "monospace" }}
              />
              <span className="field-hint">The command will run on an available worker.</span>
            </label>
          ) : (
            <div className="form-grid">
              <label className="form-field">
                <span className="field-label">Runtime</span>
                <select
                  value={runtime}
                  onChange={(event) => setRuntime(event.target.value as Runtime)}
                  className="field-control"
                >
                  <option value="PYTHON">Python</option>
                  <option value="NODE">Node.js</option>
                </select>
              </label>
              <label className="form-field">
                <span className="field-label">File</span>
                <input
                  type="file"
                  required
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="file-input"
                />
              </label>
            </div>
          )}
        </section>

        <section className="form-section">
          <div>
            <h3 className="form-section-title">Scheduling</h3>
            <p className="form-section-description">
              Run immediately, at a specific time, or on a recurring schedule.
            </p>
          </div>

          <div className="segmented-control" role="group" aria-label="Schedule type">
            {([
              ["IMMEDIATE", "Immediate"],
              ["ONCE", "One-time"],
              ["RECURRING", "Recurring"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScheduleType(value)}
                className={`segment-button${scheduleType === value ? " segment-button-selected" : ""}`}
                aria-pressed={scheduleType === value}
              >
                {label}
              </button>
            ))}
          </div>

          {scheduleType === "ONCE" && (
            <label className="form-field">
              <span className="field-label">Scheduled time</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                required
                className="field-control"
              />
            </label>
          )}

          {scheduleType === "RECURRING" && (
            <label className="form-field">
              <span className="field-label">Cron expression</span>
              <input
                type="text"
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                placeholder="e.g. */5 * * * *"
                required
                className="field-control"
                style={{ fontFamily: "monospace" }}
              />
              <span className="field-hint">Enter a valid cron expression.</span>
            </label>
          )}
        </section>

        <section className="form-section">
          <div>
            <h3 className="form-section-title">Execution policy</h3>
            <p className="form-section-description">
              Set the queue priority and retry limit for this job.
            </p>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span className="field-label">Priority</span>
              <input
                type="number"
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
                min={0}
                className="field-control"
              />
            </label>
            <label className="form-field">
              <span className="field-label">Maximum attempts</span>
              <input
                type="number"
                value={maxAttempts}
                onChange={(event) => setMaxAttempts(Number(event.target.value))}
                min={1}
                className="field-control"
              />
            </label>
          </div>
        </section>

        {error && <div className="feedback-error" role="alert">{error}</div>}

        <div className="form-footer">
          <button className="button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create job"}
          </button>
        </div>
      </form>
    </>
  );
};

export default JobForm;
