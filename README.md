# FLOW

FLOW is a distributed job scheduling and execution platform built with Node.js, TypeScript, PostgreSQL, Redis, BullMQ, React, and Vite. It is designed around a simple but practical idea: store job intent in PostgreSQL as the durable source of truth, enqueue execution work through BullMQ/Redis, and have three independent worker containers perform the actual work outside the web API. A web dashboard provides job creation, status summaries, and job activity/history views.

This repository is not just a toy scheduler. It implements a concrete system in which jobs can be created through HTTP, scheduled for immediate, one-time, or recurring execution, submitted as shell commands or uploaded Python/Node.js scripts, queued for worker consumption, retried on failure, monitored for worker liveness, and recovered if a worker dies mid-execution.

## Why FLOW exists

The system solves a straightforward backend engineering problem: how to safely and predictably execute asynchronous work at scale while keeping the system observable and recoverable.

In practice, that means:

- API requests create jobs without blocking on execution.
- Scheduling logic decides when a job becomes eligible to run.
- Redis/BullMQ moves execution work from the database into a real queue.
- Three independent workers consume jobs from the shared queue and execute either shell commands or uploaded Python/Node.js files.
- PostgreSQL remains the durable state store for job lifecycle and logs.
- A monitor detects dead workers and requeues recovery work when necessary.

This separation matters: the API is responsible for receiving requests, but job execution is intentionally decoupled from the web process so that jobs can continue even if request handling or worker processes are restarted independently.

## Key features implemented

The current codebase already includes:

- HTTP job creation, listing, lookup, update, deletion, and cancellation
- Immediate, one-time, and recurring job scheduling
- Job submission as either a shell command or an uploaded file job
- Python and Node.js job support via uploaded files and the `runtime` field (`PYTHON` or `NODE`)
- Priority-aware queue ordering
- PostgreSQL-backed job state and job history
- Per-attempt execution records, including worker, attempt number, output, exit code, timestamps, and error
- BullMQ queue delivery via Redis
- Three independent Docker worker containers consuming the same BullMQ queue concurrently
- Worker heartbeats and active monitoring
- Retry flow with fixed backoff
- Recurring job next-run scheduling based on cron expressions
- Crash recovery for jobs assigned to dead workers
- Job logs for lifecycle events
- React dashboard for job totals, recent jobs, and online worker count
- Web UI for creating, filtering, and inspecting jobs, including execution history and activity logs
- Worker listing endpoint (`GET /workers`) used by the dashboard

## High-level architecture

```mermaid
flowchart LR
    Client[Client / API Consumer] --> API[Express API\nPOST /jobs\nGET /jobs\nPATCH /jobs/:id]
    Browser[React + Vite frontend] --> API
    API --> PG[(PostgreSQL\njobs, job_logs, workers, job_executions)]
    Scheduler --> PG
    Scheduler --> Queue[Redis + BullMQ\nflow-jobs]
    Queue --> Worker1[flow-worker-1]
    Queue --> Worker2[flow-worker-2]
    Queue --> Worker3[flow-worker-3]
    Worker1 --> OS[Shell / OS Command\nPython or Node.js for uploaded files]
    Worker2 --> OS
    Worker3 --> OS
    Worker1 --> PG
    Worker2 --> PG
    Worker3 --> PG
    Monitor[Worker Monitor] --> PG
    Monitor --> Queue
```

The architecture intentionally separates responsibilities:

- PostgreSQL: durable job state, lifecycle logs, worker records, and per-attempt execution history
- BullMQ/Redis: work dispatch and retry coordination
- Workers: actual command execution
- Monitor: liveness/recovery checks
- API: ingress and CRUD operations

## Components and why they exist

| Component | Role | Why it exists |
|---|---|---|
| API server | Express app and REST endpoints | Accepts job creation and management requests without doing execution work directly |
| Frontend | React + Vite dashboard | Presents job summaries, job management, worker count, execution history, and lifecycle activity |
| PostgreSQL | Source of truth for jobs, logs, workers, and execution attempts | Keeps state durable, queryable, and auditable |
| Scheduler | Polls pending jobs and enqueues them | Moves jobs from database state to BullMQ queue |
| BullMQ + Redis | Queue, retry, and concurrency coordination | Decouples producers from consumers and provides job distribution |
| Three worker containers | Each runs the same worker service and executes either `job.command` or a Python/Node.js file from the shared queue | Separates execution from HTTP handling and allows the three consumers to process jobs concurrently |
| Worker monitor | Detects stale heartbeats from any worker and checks its running jobs | Coordinates recovery after a worker process disappears |

## Database and state model

The project initializes PostgreSQL tables in `backend/src/init_db.ts`. The important tables are:

- `jobs`: current job state, including `job_type`, `file_path`, and `runtime` for uploaded file jobs
- `job_logs`: event history for each job
- `workers`: worker identity, status, and heartbeat timestamps
- `job_executions`: one record for each worker execution attempt, including retries and recurring runs

```mermaid
erDiagram
    JOBS ||--o{ JOB_LOGS : logs
    JOBS ||--o{ JOB_EXECUTIONS : attempts
    WORKERS ||--o{ JOBS : owns

    JOBS {
        UUID id PK
        VARCHAR name
        VARCHAR job_type
        TEXT command
        TEXT file_path
        VARCHAR runtime
        INT priority
        VARCHAR status
        INT attempts
        INT max_attempts
        VARCHAR schedule_type
        TIMESTAMPTZ scheduled_at
        TEXT cron_expression
        TIMESTAMPTZ next_run_at
        TIMESTAMP created_at
        TIMESTAMP updated_at
        TIMESTAMP started_at
        TIMESTAMP completed_at
        VARCHAR worker_id
        TEXT error
    }

    JOB_LOGS {
        UUID id PK
        UUID job_id FK
        VARCHAR event
        TEXT message
        TIMESTAMP created_at
    }

    WORKERS {
        UUID id PK
        VARCHAR worker_id UK
        VARCHAR status
        TIMESTAMP last_heartbeat
        UUID current_job_id
        TIMESTAMP started_at
        TIMESTAMP updated_at
    }

    JOB_EXECUTIONS {
        UUID id PK
        UUID job_id FK
        VARCHAR worker_id
        INT attempt
        VARCHAR status
        TIMESTAMPTZ started_at
        TIMESTAMPTZ completed_at
        INT exit_code
        TEXT stdout
        TEXT stderr
        TEXT error
        TIMESTAMPTZ created_at
    }
```

### Key job fields

The `jobs` table stores:

- `job_type`: `COMMAND` for shell commands or `FILE` for uploaded script files
- `command`: command string for `COMMAND` jobs
- `file_path`: saved upload path for `FILE` jobs
- `runtime`: runtime for file jobs: `PYTHON` or `NODE`
- `status`: `PENDING`, `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`
- `schedule_type`: `IMMEDIATE`, `ONCE`, or `RECURRING`
- `scheduled_at`: when a one-time job should run
- `cron_expression`: recurring schedule
- `next_run_at`: next scheduled execution timestamp for recurring jobs
- `priority`: queue priority value from the API
- `attempts` and `max_attempts`: current execution count and retry ceiling
- `worker_id`: last worker that claimed the job
- `error`: last failure message

`job_logs` records the lifecycle events of each job, such as `CREATED`, `QUEUED`, `WORKER_ASSIGNED`, `STARTED`, `COMPLETED`, `FAILED`, and `CANCELLED`.

`job_executions` keeps per-attempt history separately from the current `jobs` row. The worker inserts a `RUNNING` record when it starts an attempt and updates that record to `COMPLETED` or `FAILED` with its completion timestamp, exit code, stdout, stderr, and error text. The table is created, with indexes on `job_id` and `worker_id`, by `npm run db:init` from `backend/`. The API exposes per-job execution history and logs through the endpoints below.

## API and request flow

The API is mounted in `backend/src/app.ts`; job routes are defined in `backend/src/routes/job.routes.ts` and worker routes in `backend/src/routes/workers.routes.ts`.

### Health

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "service": "flow-api"
}
```

### Job endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | API readiness check |
| `POST` | `/jobs` | Create a new job |
| `GET` | `/jobs` | List all jobs |
| `GET` | `/jobs/:id` | Get one job |
| `PATCH` | `/jobs/:id` | Update name, command, priority, maxAttempts |
| `DELETE` | `/jobs/:id` | Delete a job row |
| `POST` | `/jobs/:id/cancel` | Cancel `PENDING`, `QUEUED`, or `RUNNING` jobs |
| `GET` | `/jobs/:id/executions` | List per-attempt execution history |
| `GET` | `/jobs/:id/logs` | List job lifecycle logs |
| `POST` | `/jobs/queue` | Trigger scheduler-style queueing immediately |
| `GET` | `/workers` | List workers ordered by most recent heartbeat |

### Web dashboard

The React frontend is in `frontend/` and is served by Vite during development. Its current routes are `/` (dashboard), `/jobs` (searchable and status-filtered job list with job creation), and `/jobs/:id` (job details, execution attempts, and activity logs). The dashboard shows total, running, completed, and failed job counts, the online worker count, and the five most recent jobs. The UI currently offers cancellation for `PENDING` and `QUEUED` jobs; the API also accepts `RUNNING` jobs. Marking a running job cancelled does not terminate its already-running operating-system process.

The frontend API client currently targets `http://localhost:8000`, so run the API on that address when using the development server.

### Example job creation

Command job example:

```bash
curl -X POST http://localhost:8000/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "daily-report",
    "command": "echo \"daily report\"",
    "priority": 10,
    "scheduleType": "IMMEDIATE",
    "maxAttempts": 3
  }'
```

Python file job example:

```bash
curl -X POST http://localhost:8000/jobs \
  -F "name=python-job" \
  -F "runtime=PYTHON" \
  -F "priority=10" \
  -F "scheduleType=IMMEDIATE" \
  -F "maxAttempts=3" \
  -F "file=@./test_job.py"
```

This is how the API currently works in practice: the route uses `multer({ dest: "uploads/" })` and the uploaded file is submitted under the multipart form field named `file`. File jobs do not include a `command`; instead, the database stores the uploaded file path and runtime. The worker executes the file with `python3` for `PYTHON` jobs or `node` for `NODE` jobs.

Node.js file job example:

```bash
curl -X POST http://localhost:8000/jobs \
  -F "name=node-job" \
  -F "runtime=NODE" \
  -F "priority=10" \
  -F "scheduleType=IMMEDIATE" \
  -F "maxAttempts=3" \
  -F "file=@./test_job.js"
```

Example response shape for a file job:

```json
{
  "id": "5ee0f208-2af2-4d04-9b52-c32d6ab0ccef",
  "name": "python-job",
  "job_type": "FILE",
  "command": null,
  "file_path": "/app/uploads/<uuid>.py",
  "runtime": "PYTHON",
  "priority": 10,
  "status": "PENDING",
  "attempts": 0,
  "max_attempts": 3,
  "schedule_type": "IMMEDIATE",
  "scheduled_at": null,
  "cron_expression": null,
  "next_run_at": null,
  "created_at": "2026-10-03T12:00:00.000Z",
  "updated_at": "2026-10-03T12:00:00.000Z"
}
```

### Request validation

`createJob` validates:

- presence of `name`
- `command` for `COMMAND` jobs, or `runtime` for `FILE` jobs
- valid `scheduleType` (`IMMEDIATE`, `ONCE`, `RECURRING`)
- `scheduledAt` for `ONCE` jobs
- `cronExpression` for `RECURRING` jobs
- timezone-aware or local timestamp support for `scheduledAt`
- uploaded file path and job type inference in `upload.single("file")`

## Job types and scheduling semantics

### Command jobs

`COMMAND` jobs are the original execution mode. The API expects a `command` string and the worker runs it through `child_process.spawn(job.command, { shell: true })`, with stdout/stderr streamed to the worker logs and the attempt count available as `FLOW_ATTEMPT`.

### File jobs

`FILE` jobs are submitted through the same `POST /jobs` route, but the request is a multipart upload. The route uses `multer({ dest: "uploads/" })` and reads the file from the multipart field named `file`.

The controller sets:

- `job_type = "FILE"` whenever an uploaded file exists
- `file_path` to the saved upload path in `uploads/`
- `runtime` to the submitted runtime value (`runtime` is required for file jobs; the worker supports `PYTHON` and `NODE`)

The worker executes uploaded scripts directly on the worker machine using `python3` for `PYTHON` jobs or `node` for `NODE` jobs, with `shell: false`. `FLOW_ATTEMPT` is provided in the child process environment. Command and script subprocesses are terminated after a fixed 30-second timeout. File jobs use the same scheduler, retry, and state tracking pipeline as command jobs.

### Immediate jobs

`IMMEDIATE` is the default schedule type. The scheduler treats these as eligible as soon as they are created.

### One-time jobs

`ONCE` requires a `scheduledAt` field. The scheduler enqueues the job only when:

- `schedule_type = 'ONCE'`
- `scheduled_at <= NOW()`

The database stores timestamps in PostgreSQL as `TIMESTAMPTZ` and does a timezone normalization step during schema initialization.

### Recurring jobs

`RECURRING` requires a valid `cronExpression`. The code calculates an initial `next_run_at` using `cron-parser` and then advances it after each successful execution.

```mermaid
sequenceDiagram
    participant API as API
    participant DB as PostgreSQL
    participant Scheduler as Scheduler
    participant Queue as BullMQ / Redis
    participant Worker as One of three workers

    API->>DB: INSERT jobs (schedule_type='RECURRING', cron_expression, next_run_at)
    Scheduler->>DB: Poll jobs where next_run_at <= NOW()
    Scheduler->>DB: status = QUEUED
    Scheduler->>Queue: add execute-job
    Queue-->>Worker: dispatch job to an available worker
    Worker->>DB: UPDATE status = RUNNING
    Worker->>Worker: Execute command or uploaded script
    alt success
        Worker->>DB: status = PENDING, next_run_at = next execution timestamp
        Worker->>DB: INSERT job_logs (COMPLETED)
    else fail
        Worker->>DB: status = QUEUED or FAILED
        Worker-->>Queue: throw error so BullMQ can retry
    end
```

## Scheduler and queue flow

The scheduler process runs `backend/src/scheduler/scheduler.ts`, which calls `startScheduler()` from `backend/src/scheduler/scheduler.service.ts`.

It polls every 5 seconds and applies this logic:

```sql
UPDATE jobs
SET status = 'QUEUED', updated_at = NOW()
WHERE status = 'PENDING'
  AND (
    schedule_type = 'IMMEDIATE'
    OR (schedule_type = 'ONCE' AND scheduled_at <= NOW())
    OR (schedule_type = 'RECURRING' AND next_run_at <= NOW())
  )
RETURNING *;
```

After the job is selected for queueing, the scheduler adds a BullMQ job to the `flow-jobs` queue using the `jobQueue.add()` call.

### Queue implementation

`backend/src/queues/job.queue.ts` creates:

```ts
export const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const jobQueue = new Queue("flow-jobs", { connection });
```

The queue uses the `flow-jobs` queue name and the Redis connection defined by `REDIS_URL`.

## BullMQ execution IDs and `getBullMQExecutionId()`

The project gives every BullMQ job an execution-specific identifier. This is implemented in `getBullMQExecutionId()`.

```ts
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
  return `${job.id}-${executionTimestamp}`;
};
```

Why this exists:

- A recurring job has many future executions but only one durable database row.
- The same recurring job should not be re-enqueued with the same BullMQ job ID during scheduler retries.
- The execution ID includes the `next_run_at` timestamp, so each scheduled occurrence has a distinct BullMQ identity while still being tied to the same logical job row.
- This is important when the scheduler re-evaluates the same recurring job later and wants to avoid creating duplicate queue entries for the same scheduled occurrence.

In short, the database row represents the job definition, while the BullMQ execution ID represents a concrete execution at a specific time.

## Job lifecycle from creation to completion

```mermaid
flowchart TD
    A[Create Job via API] --> B[INSERT into jobs + job_logs]
    B --> C[status = PENDING]
    C --> D[Scheduler polls every 5s]
    D --> E[status = QUEUED]
    E --> F[Add BullMQ job to flow-jobs]
    F --> G[Worker picks job]
    G --> H[status = RUNNING\nattempts = attempts + 1]
    H --> I[Execute command or uploaded script]
    I --> J{Execution succeeded?}
    J -- Yes --> K[Recurring?]
    K -- Yes --> L[status = PENDING\nnext_run_at = next cron occurrence]
    K -- No --> M[status = COMPLETED]
    J -- No --> N{BullMQ attempts remain?}
    N -- Yes --> O[Retry after 2s\nDB retains latest state/error]
    O --> G
    N -- No --> P[status = FAILED]
```

## Retry and backoff behavior

The retry logic is split between PostgreSQL execution history and BullMQ behavior. On failure, `handleJobFailure()` stores the error and clears the worker assignment, then rethrows; it does not set the database job back to `QUEUED` between retries. BullMQ schedules the retry, and the next worker attempt marks the database job `RUNNING` again.

When a command or uploaded script fails in `backend/src/jobs/job_processor.service.ts`, the worker updates that attempt's `job_executions` record with the error, captured output, and exit code when available, records the failure in `job_logs`, stores the latest error on the job, and re-throws the error so BullMQ can apply its retry policy. Non-zero exits, spawn errors, and execution timeouts all follow this path. The worker also refuses to mark a job `RUNNING` once its database attempt count has reached `max_attempts`.

BullMQ is configured with:

```ts
attempts: job.max_attempts,
backoff: {
  type: "fixed",
  delay: 2000,
},
removeOnComplete: true,
```

The scheduler configures BullMQ with `job.max_attempts` attempts, a fixed 2-second backoff, and removal of completed queue entries. PostgreSQL retains the job's latest state/error and each attempt's result in `job_executions`; when all attempts are exhausted, the worker's BullMQ failure handler marks the database job `FAILED`.

### Retry flow

```mermaid
flowchart LR
    A[Worker runs command or script] --> B{Execution succeeds?}
    B -- No --> C[Update job error + logs]
    C --> D{BullMQ attempts remain?}
    D -- Yes --> E[BullMQ retry after 2s fixed backoff]
    E --> F[Worker picks job again]
    D -- No --> H[status = FAILED]
```

## Worker execution model

Worker startup is in `backend/src/worker/worker.ts`; it calls `startWorker()` from `backend/src/worker/worker.service.ts`. Each worker starts a BullMQ `Worker` with concurrency set to 3:

```ts
const worker = new Worker(
  "flow-jobs",
  async (job) => {
    await processJob(job);
  },
  {
    connection,
    concurrency: 3,
    stalledInterval: 5000,
    maxStalledCount: 3,
  },
);
```

The Docker Compose deployment runs three independent worker containers—`flow-worker-1`, `flow-worker-2`, and `flow-worker-3`—each executing the same `backend/src/worker/worker.ts` entry point and consuming the shared `flow-jobs` queue. Each worker process has `concurrency: 3`, so the three configured workers can collectively run up to nine jobs concurrently, subject to available resources and queued work. The workers are separate processes, not a single worker instance replicated internally.

Running `npm run dev:worker` locally starts one worker process. It does not start all three Compose workers.

### Worker execution details

When a job is picked up, the worker:

1. Reads the job from PostgreSQL using `job.data.jobId`
2. Checks whether the job has been cancelled
3. Marks the job `RUNNING`
4. Increments `attempts`
5. Creates a `job_executions` record for the attempt
6. Executes the right runtime for the job type:
   - `COMMAND`: runs `job.command` with `child_process.spawn(..., { shell: true })`
   - `FILE`: runs `python3 job.file_path` for `PYTHON` or `node job.file_path` for `NODE`, with `shell: false`
7. Streams stdout/stderr to the worker logs and stores the captured output plus exit code in `job_executions`
8. Updates the execution record and job state in PostgreSQL on success or failure
9. Re-throws on failure so BullMQ handles the retry backoff

Python and Node.js jobs follow the same lifecycle and retry path as shell-command jobs: `PENDING` → `QUEUED` → `RUNNING` → `job_executions` record → success or failure → BullMQ retry if attempts remain, otherwise `FAILED`. Command and script subprocesses have a fixed 30-second timeout.

## Worker heartbeat and monitoring

Each of the three worker processes gets its own unique ID using the host name plus a UUID fragment (unless `WORKER_ID` is explicitly set). Every worker registers its identity in PostgreSQL and updates its own `last_heartbeat` every 5 seconds. The three Compose container names are `flow-worker-1`, `flow-worker-2`, and `flow-worker-3`; the default database `worker_id` is generated by the process and is not explicitly set to those container names in Compose.

```ts
export const startHeartbeat = () => {
  setInterval(async () => {
    await pool.query(
      `
      UPDATE workers
      SET last_heartbeat = NOW(), status = 'ONLINE', updated_at = NOW()
      WHERE worker_id = $1
      `,
      [workerId],
    );
  }, 5000);
};
```

The single monitor process runs separately via `backend/src/worker/monitor.ts` and `backend/src/worker/worker_monitor.service.ts`. It checks all worker records and marks any worker offline if that worker fails to heartbeat within 15 seconds. When one of the three workers is marked offline, it inspects jobs recorded as running under that worker ID and uses BullMQ state to decide whether recovery is needed.

```mermaid
flowchart TD
    A[Worker heartbeat every 5s] --> B[Update workers.last_heartbeat]
    C[Monitor every 5s] --> D{Has heartbeat expired > 15s?}
    D -- Yes --> E[Mark worker OFFLINE]
    E --> F[Recover jobs WHERE status='RUNNING' AND worker_id = deadWorker]
    F --> G{Does BullMQ still own the job?}
    G -- Yes --> H[Do nothing; rely on BullMQ recovery]
    G -- No --> I[Requeue job or mark FAILED if attempts exhausted]
```

This is the project’s crash-recovery mechanism for all three workers. If any worker disappears while holding a running job, the monitor detects its stale heartbeat and requeues the work if necessary.

## Job logs and execution state

The worker logs each stage of execution. The logs are written to the `job_logs` table with events like:

- `CREATED`
- `QUEUED`
- `WORKER_ASSIGNED`
- `STARTED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

`job_logs` is the lifecycle event stream, while `job_executions` records the outcome and timing of each individual worker attempt. A retried job therefore has multiple execution rows even though it still has one `jobs` row. Recurring runs also create separate execution records against their shared job definition.

The `jobs` row remains the durable current state machine. For example:

- `PENDING` means the job has been created but not yet eligible to queue
- `QUEUED` means the scheduler has moved it into the BullMQ-ready state
- `RUNNING` means a worker claimed it and is executing the command or uploaded script
- `COMPLETED` means execution succeeded
- `FAILED` means maximum retry attempts were exhausted
- `CANCELLED` means cancellation was recorded; cancelling an already-running job does not terminate its operating-system process

## Project structure

```text
FLOW/
├── backend/
│   ├── Dockerfile
│   ├── Dockerfile.worker
│   ├── docker-compose.yml
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── app.ts
│       ├── db.ts
│       ├── init_db.ts
│       ├── server.ts
│       ├── controllers/
│       │   ├── job.controller.ts
│       │   └── workers.controller.ts
│       ├── executors/
│       │   ├── command.executor.ts
│       │   └── script.executor.ts
│       ├── jobs/
│       ├── queues/
│       ├── routes/
│       ├── scheduler/
│       └── worker/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── components/
│       ├── hooks/
│       ├── pages/
│       └── services/api.ts
└── README.md
```

## Docker and local runtime

### Start the infrastructure with Docker Compose

```bash
docker compose -f backend/docker-compose.yml up -d --build
```

This starts:

- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- API on `localhost:8000`
- Scheduler process
- Three independent worker containers: `flow-worker-1`, `flow-worker-2`, and `flow-worker-3`
- Monitor process

The worker services are intentionally built from a dedicated `Dockerfile.worker` image that installs `python3` for uploaded Python jobs; its Node.js base image also provides Node.js for uploaded Node.js jobs. The API and each worker mount the same `./uploads` directory so the file uploaded to the API is available to the worker when it later executes the script.

The three Compose worker services are `worker-1`, `worker-2`, and `worker-3`; their container names are `flow-worker-1`, `flow-worker-2`, and `flow-worker-3`. All run `node dist/worker/worker.js`, connect to the same Redis queue and PostgreSQL database, and send independent heartbeats. Each has BullMQ concurrency set to 3.

Initialize the schema once before using the API. With the Compose PostgreSQL port published locally and `DATABASE_URL` pointing to `localhost:5432`, run this from the repository root:

```bash
cd backend
npm run db:init
```

### Local development commands

Run backend commands from `backend/`. Install dependencies:

```bash
cd backend
npm install
```

For local development, have PostgreSQL and Redis running and set `DATABASE_URL` and `REDIS_URL` in `backend/.env` before starting the API, scheduler, worker, or monitor.

Initialize the PostgreSQL schema:

```bash
npm run db:init
```

Start the API in watch mode:

```bash
npm run dev
```

Start the scheduler in watch mode:

```bash
npm run dev:scheduler
```

Start one worker process in watch mode:

```bash
npm run dev:worker
```

To run the full backend Docker deployment with all three workers instead, use `docker compose -f backend/docker-compose.yml up -d --build` from the repository root. The Compose stack does not include the frontend; run its Vite development server separately. Do not also start local worker processes unless additional consumers are intended.

Start the monitor in watch mode:

```bash
npm run dev:monitor
```

Build production JS:

```bash
npm run build
```

Run the compiled API server:

```bash
npm start
```

Run the compiled scheduler, one worker, or the monitor:

```bash
npm run start:scheduler
npm run start:worker
npm run start:monitor
```

### Frontend development commands

The frontend calls the API at `http://localhost:8000`. Start the backend and its PostgreSQL/Redis dependencies first, then run these commands from `frontend/`:

```bash
cd frontend
npm install
npm run dev
```

The Vite development server prints the local URL when it starts (normally `http://localhost:5173`). To check the frontend production build or lint it, run `npm run build` or `npm run lint` from `frontend/`.

## Environment variables

The project relies on the following environment values:

| Variable | Purpose | Typical value |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the API, scheduler, worker, and monitor | `postgresql://flow:flow@localhost:5432/flow` |
| `REDIS_URL` | Redis connection string for BullMQ | `redis://localhost:6379` |
| `PORT` | API port | `8000` |
| `WORKER_ID` | Optional explicit worker identity | Hostname + UUID suffix |

The `backend/.env` file used locally looks like this:

```env
DATABASE_URL="postgresql://flow:flow@localhost:5432/flow"
PORT=8000
REDIS_URL=redis://localhost:6379
```

Docker Compose injects the same service values for the containerized environment, using the Redis service name `redis` and PostgreSQL service name `postgres` instead of `localhost`.

## Design decisions and tradeoffs

### PostgreSQL as the authoritative state store

The implementation keeps a durable, queryable record of each job in PostgreSQL rather than relying on Redis alone. This makes failure analysis and operational inspection easier.

### Redis/BullMQ for actual work distribution

BullMQ is used as the queue transport. This gives the project real work distribution semantics without having to build a custom queue scheduler from scratch.

### Scheduler polling instead of event-driven scheduling

The scheduler runs a `setInterval` every 5 seconds and checks for ready jobs. This is a simple and effective pattern for a proof-of-concept system, but it is not as event-driven or low-latency as a production scheduler using more advanced queue orchestration.

### Three worker containers and per-process concurrency

Compose defines three independent worker services, each running the same worker implementation with `concurrency: 3`. Together they can process up to nine jobs at a time when enough work is queued and system resources are available. This demonstrates concurrent queue consumption without introducing autoscaling or per-job resource quotas.

### Process-level command and script execution

The actual task is executed with Node's `child_process.spawn()`. Command jobs run with `shell: true`, while uploaded Python and Node.js files run with `shell: false` using `python3` or `node`. Both execution paths use a fixed 30-second timeout. In Docker, the worker image installs Python explicitly via `Dockerfile.worker`, and the API and workers share the same `./uploads` mount so uploaded files remain accessible to the executing worker. This is simple and direct, but it is also a trust boundary. The implementation is intentionally not hardened against arbitrary command injection or untrusted job definitions.

## Failure scenarios and current handling

### Job fails once

The worker records the failed attempt and latest error, then rethrows the error so BullMQ can handle the retry. During the backoff the database row is not reset to `QUEUED`; the next attempt marks it `RUNNING`, while exhausting BullMQ attempts marks it `FAILED`.

### Worker crashes mid-job

The worker monitor checks heartbeats. If the worker stops heartbeating, the monitor marks it offline and inspects the jobs it was running. If BullMQ still owns the job, it leaves it alone; otherwise it requeues the job or marks it failed if retries are exhausted.

### Job is cancelled

`POST /jobs/:id/cancel` accepts `PENDING`, `QUEUED`, and `RUNNING` jobs, marks the PostgreSQL row as `CANCELLED`, and attempts to remove the BullMQ job if it exists. The web UI currently displays the cancel action only for `PENDING` and `QUEUED` jobs. Cancelling a `RUNNING` job does not terminate its already-running command or script process.

### Recurring job needs a new schedule

On successful completion, the recurring job is reset to `PENDING` and `next_run_at` is advanced by `calculateNextRun()`, using the cron spec and the current time.

### A job exhausts its retries

The worker updates the job to `FAILED` and stores the last error in `error`.

## Future improvements

The current codebase is a solid foundation, but several production-grade improvements are still missing or intentionally simple:

- stronger job idempotency and deduplication keys
- result payload storage for completed work
- configurable timeouts and explicit cancellation of active shell/script subprocesses (the current executor timeout is fixed at 30 seconds)
- dead-letter queue handling for permanently failed jobs
- richer job dependency and fan-out orchestration
- queue rate limits / concurrency quotas per job type
- richer dashboard and worker health views beyond the current summary counts and online-worker count
- authentication, authorization, and role-based API access
- multi-node deployment orchestration, container scheduling, and observability
- retry policies that vary per job type instead of one fixed backoff configuration

## Practical summary

FLOW is a working example of a job-scheduler architecture where:

- the API creates durable job records;
- the scheduler decides which jobs are ready;
- Redis/BullMQ picks up the ready work and dispatches it;
- multiple workers do the actual execution;
- PostgreSQL is the durable truth for lifecycle and logs;
- the monitor protects the system from dead-worker conditions.

It is intentionally simple, but it demonstrates the core building blocks of a serious backend scheduling platform rather than a purely academic mockup.

## Running the system

```bash
docker compose -f backend/docker-compose.yml up -d --build
cd backend
npm run db:init
```

This starts the API, scheduler, monitor, and all three workers in Compose. Backend local-development commands run from `backend/`: `npm run dev`, `npm run dev:scheduler`, `npm run dev:worker`, and `npm run dev:monitor` are separate commands/processes; `npm run dev:worker` starts one worker instance only. Run the frontend separately from `frontend/` with `npm run dev`.

Then interact with the API at `http://localhost:8000`.

For example:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/jobs
```

## Final note

This README is based on the actual implementation in the repository. The project is a real operating job system with a PostgreSQL-backed state machine, Redis/BullMQ queueing, worker execution, retries, and monitoring rather than a hypothetical design document.