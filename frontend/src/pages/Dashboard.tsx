import StatCard from "../components/dashboard/StatCard";
import RecentJobs from "../components/dashboard/RecentJobs";
import { useJobs } from "../hooks/useJobs";
import { useWorkers } from "../hooks/useWorkers";

const Dashboard = () => {
  const { jobs, loading: jobsLoading } = useJobs();
  const { workers, loading: workersLoading } = useWorkers();

  if (jobsLoading || workersLoading) {
    return <p>Loading dashboard...</p>;
  }

  const totalJobs = jobs.length;

  const runningJobs = jobs.filter((job) => job.status === "RUNNING").length;

  const completedJobs = jobs.filter((job) => job.status === "COMPLETED").length;

  const failedJobs = jobs.filter((job) => job.status === "FAILED").length;

  const onlineWorkers = workers.filter(
    (worker) => worker.status === "ONLINE",
  ).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your job scheduling system.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Jobs" value={totalJobs} />

        <StatCard title="Running" value={runningJobs} />

        <StatCard title="Completed" value={completedJobs} />

        <StatCard title="Failed" value={failedJobs} />
      </div>

      <div className="mt-6 rounded-xl border bg-white p-6">
        <h2 className="text-lg font-semibold">Workers</h2>

        <p className="mt-2 text-sm text-gray-500">
          {onlineWorkers} of 3 workers online
        </p>
      </div>
      <div className="mt-6">
        <RecentJobs jobs={jobs} />
      </div>
    </div>
  );
};

export default Dashboard;
