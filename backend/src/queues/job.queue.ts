/*
  FLOW Job Queue

  BullMQ uses Redis to manage the queue of jobs.

  PostgreSQL remains responsible for permanently storing
  job metadata and execution state.

  Redis/BullMQ is responsible for distributing work
  to workers.
*/

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

export const connection = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const jobQueue = new Queue("flow-jobs", {
  connection,
});

export const getBullMQExecutionId = (job: {
  id: string;
  schedule_type: string;
  next_run_at: Date | string | null;
}) => {
  if (job.schedule_type !== "RECURRING") {
    return job.id;
  }

  if (job.next_run_at === null) {
    throw new Error(`Recurring job ${job.id} has no next_run_at`);
  }

  const nextRunAt =
    job.next_run_at instanceof Date
      ? job.next_run_at
      : new Date(job.next_run_at);
  const executionTimestamp = nextRunAt.getTime();

  if (!Number.isFinite(executionTimestamp)) {
    throw new Error(`Recurring job ${job.id} has an invalid next_run_at`);
  }

  return `${job.id}-${executionTimestamp}`;
};

//name of the queue is flow-jobs