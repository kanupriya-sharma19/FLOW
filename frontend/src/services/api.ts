import axios from "axios";
import type { Job, JobExecution, JobLog} from "../types/job";
import type { Worker } from "../types/worker.js";

const api = axios.create({
  baseURL: "http://localhost:8000",
});

export const getJobs = async (): Promise<Job[]> => {
  const response = await api.get("/jobs");
  return response.data;
};

export const getJob = async (id: string): Promise<Job> => {
  const response = await api.get(`/jobs/${id}`);
  return response.data;
};

export const createJob = async (data: FormData | object): Promise<Job> => {
  const response = await api.post("/jobs", data);
  return response.data;
};

export const updateJob = async (
  id: string,
  data: object,
): Promise<Job> => {
  const response = await api.patch(`/jobs/${id}`, data);
  return response.data;
};

export const deleteJob = async (id: string): Promise<void> => {
  await api.delete(`/jobs/${id}`);
};

export const cancelJob = async (id: string): Promise<Job> => {
  const response = await api.post(`/jobs/${id}/cancel`);
  return response.data;
};

export const getJobExecutions = async (
  id: string,
): Promise<JobExecution[]> => {
  const response = await api.get(`/jobs/${id}/executions`);
  return response.data;
};

export const getJobLogs = async (id: string): Promise<JobLog[]> => {
  const response = await api.get(`/jobs/${id}/logs`);
  return response.data;
};

export const getWorkers = async (): Promise<Worker[]> => {
  const response = await api.get("/workers");
  return response.data;
};

export default api;