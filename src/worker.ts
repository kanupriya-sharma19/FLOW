/*
  FLOW Worker Process

  This file starts the worker as a separate Node.js process
  from the main API server.

  The API server is responsible for:
    - Handling HTTP requests
    - Creating and managing jobs
    - Running the scheduler

  The worker is responsible for:
    - Finding queued jobs
    - Executing job commands
    - Updating job status and attempts
    - Handling retries and failures

  The worker does not use Express or an HTTP port because
  it does not receive client requests directly.

  Later, Redis/BullMQ will replace PostgreSQL polling and
  act as the queue between the API and workers.
*/

import dotenv from "dotenv";
import { startWorker } from "./services/worker.service.js";

dotenv.config();

console.log("Starting FLOW Worker...");

startWorker();