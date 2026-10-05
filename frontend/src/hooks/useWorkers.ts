import { useEffect, useState } from "react";
import { getWorkers } from "../services/api";
import type { Worker } from "../types/worker";

export const useWorkers = () => {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkers = async () => {
    try {
      setError(null);

      const data = await getWorkers();

      setWorkers(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load workers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers();

    const interval = setInterval(() => {
      fetchWorkers();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return {
    workers,
    loading,
    error,
    refetch: fetchWorkers,
  };
};