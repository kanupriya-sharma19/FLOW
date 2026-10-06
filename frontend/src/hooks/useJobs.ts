import { useEffect, useState } from "react";
import { getJobs } from "../services/api";
import type { Job } from "../types/job.js";

export const useJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      setError(null);

      const data = await getJobs();

      setJobs(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    const interval = setInterval(() => {
      fetchJobs();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return {
    jobs,
    loading,
    error,
    refetch: fetchJobs,
  };
};
