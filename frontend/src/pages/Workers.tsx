import { useWorkers } from "../hooks/useWorkers";

const isWorkerStale = (lastHeartbeat: string | null) => {
  if (!lastHeartbeat) return true;

  const heartbeatTime = new Date(lastHeartbeat).getTime();
  const now = Date.now();

  return now - heartbeatTime > 15000;
};

const formatTimestamp = (timestamp: string | null) => {
  if (!timestamp) return "—";

  const date = new Date(timestamp);

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });
};

const Workers = () => {
  const { workers, loading, error } = useWorkers();

  if (loading) {
    return <p>Loading workers...</p>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Workers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Monitor worker health and activity.
        </p>
      </div>

      {workers.length === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center">
          <p className="text-gray-500">No workers found.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workers.map((worker) => {
            const stale = isWorkerStale(worker.last_heartbeat);

            return (
              <div
                key={worker.worker_id}
                className="rounded-xl border bg-white p-5"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-medium">{worker.worker_id}</h2>

                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      stale
                        ? "bg-red-100 text-red-700"
                        : worker.status === "ONLINE"
                          ? "bg-green-100 text-green-700"
                          : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {stale ? "STALE" : worker.status}
                  </span>
                </div>

                <div className="mt-5 space-y-3 text-sm">
                  <div>
                    <p className="text-gray-500">Current Job</p>
                    <p className="mt-1">{worker.current_job_id || "Idle"}</p>
                  </div>

                  <div>
                    <p className="text-gray-500">Last Heartbeat</p>
                    <p className="mt-1">
                      {formatTimestamp(worker.last_heartbeat)}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500">Started</p>
                    <p className="mt-1">
                        {formatTimestamp(worker.started_at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Workers;
