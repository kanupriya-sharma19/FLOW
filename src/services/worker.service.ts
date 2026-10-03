/*
  FLOW Worker — BullMQ

  Job lifecycle:

      PENDING
         ↓
      Scheduler
         ↓
      QUEUED
         ↓
      BullMQ / Redis
         ↓
      Worker picks the job
         ↓
      RUNNING
         ↓
      Execute job.command
         ↓
      ┌───────────────┴───────────────┐
      ↓                               ↓
  command succeeds               command fails
      ↓                               ↓
  COMPLETED                    BullMQ checks attempts
                                      │
                               ┌──────┴──────┐
                               ↓             ↓
                            attempts       attempts
                            remaining      exhausted
                               ↓             ↓
                           retry after     FAILED
                           backoff
                               │
                               ↓
                          Worker runs
                          the job again


  PostgreSQL:
    - Permanent source of truth for job state and logs.
    - Stores execution attempts and history.

  Redis/BullMQ:
    - Temporary/distributed queue.
    - Delivers jobs to available workers.
    - Handles retries and backoff.
*/

import { Worker } from "bullmq";
import { Redis } from "ioredis";
import dotenv from "dotenv";
import {
  workerId,
  registerWorker,
  startHeartbeat,
} from "./worker_heartbeat.service.js";
import { connection } from "../queues/job.queue.js";

import { processJob } from "./job_processor.service.js";

dotenv.config();

// --------------------------------------------------
// Start BullMQ Worker
// --------------------------------------------------

export const startWorker = async ()  => {
  console.log(`FLOW BullMQ Worker started: ${workerId}`);
  await registerWorker();

  startHeartbeat();

  const worker = new Worker(
    "flow-jobs",

    async (job) => {

      await processJob(job);
    },

    {
      connection,
      // Number of jobs this worker process can
      // execute concurrently.
      concurrency: 3,
       // Detect workers that disappear while holding active jobs
      stalledInterval: 5000,
      maxStalledCount: 3, //BullMQ will allow the same job to be recovered from a stalled state up to 3 times.
    },
  );

  // --------------------------------------------------
  // BullMQ worker events
  // --------------------------------------------------
  worker.on("completed", (job) => {
    console.log(`[${workerId}] BullMQ job completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[${workerId}] BullMQ job failed: ${job?.id}`, error.message);
  });

  worker.on("error", (error) => {
    console.error(`[${workerId}] BullMQ worker error:`, error);
  });
};
