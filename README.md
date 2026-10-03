# FLOW

FLOW is a distributed job scheduling and execution platform built with Node.js, TypeScript, PostgreSQL, Redis, and BullMQ. It is designed around a simple but practical idea: store job intent in PostgreSQL as the durable source of truth, enqueue execution work through BullMQ/Redis, and have one or more workers perform the actual work outside the web API.

This repository is not just a toy scheduler. It implements a concrete system in which jobs can be created through HTTP, scheduled for immediate, one-time, or recurring execution, queued for worker consumption, retried on failure, monitored for worker liveness, and recovered if a worker dies mid-execution.

## Why FLOW exists

The system solves a straightforward backend engineering problem: how to safely and predictably execute asynchronous work at scale while keeping the system observable and recoverable.

In practice, that means:

- API requests create jobs without blocking on execution.
- Scheduling logic decides when a job becomes eligible to run.
- Redis/BullMQ moves execution work from the database into a real queue.
- Workers consume jobs and execute shell commands.
- PostgreSQL remains the durable state store for job lifecycle and logs.
- A monitor detects dead workers and requeues recovery work when necessary.

This separation matters: the API is responsible for receiving requests, but job execution is intentionally decoupled from the web process so that jobs can continue even if request handling or worker processes are restarted independently.

## Key features implemented

The current codebase already includes:

- HTTP job creation, listing, lookup, update, deletion, and cancellation
- Immediate, one-time, and recurring job scheduling
- Priority-aware queue ordering
- PostgreSQL-backed job state and job history
- BullMQ queue delivery via Redis
- Multiple worker processes with independent concurrency
- Worker heartbeats and active monitoring
- Retry flow with fixed backoff
- Recurring job next-run scheduling based on cron expressions
- Crash recovery for jobs assigned to dead workers
- Job logs for lifecycle events

## High-level architecture

```mermaid
flowchart LR
    Client[Client / API Consumer] --> API[Express API\nPOST /jobs\nGET /jobs\nPATCH /jobs/:id]
    API --> PG[(PostgreSQL\njobs, job_logs, workers)]
    API --> Scheduler[Scheduler Process]
    Scheduler --> PG
    Scheduler --> Queue[Redis + BullMQ\nflow-jobs]
    Queue --> Worker1[Worker Process 1]
    Queue --> Worker2[Worker Process 2]
    Queue --> WorkerN[Worker Process N]
    Worker1 --> OS[Shell / OS Command]
    Worker2 --> OS
    WorkerN --> OS
    Worker1 --> PG
    Worker2 --> PG
    WorkerN --> PG
    Monitor[Worker Monitor] --> PG
    Monitor --> Queue
```

The architecture intentionally separates responsibilities:

- PostgreSQL: durable state
- BullMQ/Redis: work dispatch and retry coordination
- Workers: actual command execution
- Monitor: liveness/recovery checks
- API: ingress and CRUD operations

## Components and why they exist

| Component | Role | Why it exists |
|---|---|---|
| API server | Express app and REST endpoints | Accepts job creation and management requests without doing execution work directly |
| PostgreSQL | Source of truth for jobs and logs | Keeps state durable, queryable, and auditable |
| Scheduler | Polls pending jobs and enqueues them | Moves jobs from database state to BullMQ queue |
| BullMQ + Redis | Queue, retry, and concurrency coordination | Decouples producers from consumers and provides job distribution |
| Worker process | Executes `job.command` | Isolates execution from HTTP handling and allows horizontal scaling |
| Worker monitor | Detects dead workers and requeues work | Recovers from crashes without losing job ownership entirely |

## Database and state model

The project initializes PostgreSQL tables in `src/init-db.ts`. The important tables are:

- `jobs`: current job state
- `job_logs`: event history for each job
- `workers`: worker identity, status, and heartbeat timestamps

```mermaid
erDiagram
    JOBS ||--o{ JOB_LOGS : logs
    WORKERS ||--o{ JOBS : owns

    JOBS {
        UUID id PK
        VARCHAR name
        TEXT command
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
```

### Key job fields

The `jobs` table stores:

- `status`: `PENDING`, `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`
- `schedule_type`: `IMMEDIATE`, `ONCE`, or `RECURRING`
- `scheduled_at`: when a one-time job should run
- `cron_expression`: recurring schedule
- `next_run_at`: next scheduled execution timestamp for recurring jobs
- `priority`: queue priority value from the API
- `attempts` and `max_attempts`: current execution count and retry ceiling
- `worker_id`: last worker that claimed the job
- `error`: last failure message

`job_logs` records the lifecycle events of each job, such as `CREATED`, `QUEUED`, `STARTED`, `COMPLETED`, `FAILED`, `RETRYING`, and `CANCELLED`.

## API and request flow

The API is mounted in `src/app.ts` and all job routes are defined in `src/routes/job.routes.ts`.

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
| `POST` | `/jobs/:id/cancel` | Cancel `PENDING` or `QUEUED` jobs |
| `POST` | `/jobs/queue` | Trigger scheduler-style queueing immediately |

### Example job creation

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

Example response shape:

```json
{
  "id": "5ee0f208-2af2-4d04-9b52-c32d6ab0ccef",
  "name": "daily-report",
  "command": "echo \"daily report\"",
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

- presence of `name` and `command`
- valid `scheduleType` (`IMMEDIATE`, `ONCE`, `RECURRING`)
- `scheduledAt` for `ONCE` jobs
- `cronExpression` for `RECURRING` jobs
- timezone-aware or local timestamp support for `scheduledAt`

## Job types and scheduling semantics

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
    participant Worker as Worker

    API->>DB: INSERT jobs (schedule_type='RECURRING', cron_expression, next_run_at)
    Scheduler->>DB: Poll jobs where next_run_at <= NOW()
    Scheduler->>DB: status = QUEUED
    Scheduler->>Queue: add execute-job
    Queue-->>Worker: dispatch job
    Worker->>DB: UPDATE status = RUNNING
    Worker->>Worker: exec(job.command)
    alt success
        Worker->>DB: status = PENDING, next_run_at = next execution timestamp
        Worker->>DB: INSERT job_logs (COMPLETED)
    else fail
        Worker->>DB: status = QUEUED or FAILED
        Worker-->>Queue: throw error so BullMQ can retry
    end
```

## Scheduler and queue flow

The scheduler process runs `src/scheduler.ts`, which calls `startScheduler()` from `src/services/scheduler.service.ts`.

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

`src/queues/job.queue.ts` creates:

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
    H --> I[Execute job.command]
    I --> J{Command succeeded?}
    J -- Yes --> K[Recurring?]
    K -- Yes --> L[status = PENDING\nnext_run_at = next cron occurrence]
    K -- No --> M[status = COMPLETED]
    J -- No --> N{attempts < max_attempts?}
    N -- Yes --> O[status = QUEUED\nBullMQ retry with backoff]
    N -- No --> P[status = FAILED]
```

## Retry and backoff behavior

The retry logic is split between PostgreSQL state and BullMQ behavior.

When a worker catches a command failure in `src/services/job_processor.service.ts`, it:

1. Inserts a `FAILED` log entry with the execution error
2. Checks whether `job.attempts < job.max_attempts`
3. Updates the database to `QUEUED` and clears the worker assignment
4. Re-throws the error so BullMQ can complete its retry policy

BullMQ is configured with:

```ts
attempts: job.max_attempts,
backoff: {
  type: "fixed",
  delay: 2000,
},
removeOnComplete: true,
```

This means:

- the PostgreSQL job row tracks the logical retry state
- BullMQ decides when to retry based on the configured attempts and fixed backoff
- the worker leaves the job in `QUEUED` for the scheduler to pick it again after the worker fails and the queue replays it

### Retry flow

```mermaid
flowchart LR
    A[Worker runs command] --> B{Command succeeds?}
    B -- No --> C[Update job error + logs]
    C --> D{Current attempts < max_attempts?}
    D -- Yes --> E[status = QUEUED]
    E --> F[BullMQ retry after 2s fixed backoff]
    F --> G[Worker picks job again]
    D -- No --> H[status = FAILED]
```

## Worker execution model

Worker startup is in `src/worker.ts`. The worker starts a BullMQ `Worker` with a configurable concurrency of 3:

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

This means each Node process can handle up to three jobs concurrently. Multiple worker processes can run independently, allowing the same queue to be processed across more than one machine or container.

### Worker execution details

When a job is picked up, the worker:

1. Reads the job from PostgreSQL using `job.data.jobId`
2. Checks whether the job has been cancelled
3. Marks the job `RUNNING`
4. Increments `attempts`
5. Executes `child_process.exec(job.command)`
6. Updates success/failure state in PostgreSQL
7. Re-throws on failure so BullMQ handles the retry backoff

## Worker heartbeat and monitoring

Each worker gets a unique ID using the host name plus a UUID fragment. It registers itself in PostgreSQL and updates a `last_heartbeat` every 5 seconds.

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

The monitor runs separately via `src/monitor.ts` and `src/services/worker_monitor.service.ts`. It marks workers offline if they fail to heartbeat within 15 seconds.

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

This is the project’s crash-recovery mechanism. If a worker disappears while holding a running job, the monitor detects the stale worker and requeues the work if necessary.

## Job logs and execution state

The worker logs each stage of execution. The logs are written to the `job_logs` table with events like:

- `CREATED`
- `QUEUED`
- `STARTED`
- `RETRYING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

The database row itself is the durable state machine. For example:

- `PENDING` means the job has been created but not yet eligible to queue
- `QUEUED` means the scheduler has moved it into the BullMQ-ready state
- `RUNNING` means a worker claimed it and is executing `job.command`
- `COMPLETED` means execution succeeded
- `FAILED` means maximum retry attempts were exhausted
- `CANCELLED` means the job was cancelled before execution or while still waiting in the queue

## Project structure

```text
FLOW/
├── Dockerfile
├── docker-compose.yml
├── .env
├── package.json
├── tsconfig.json
├── src/
│   ├── app.ts
│   ├── db.ts
│   ├── init-db.ts
│   ├── monitor.ts
│   ├── scheduler.ts
│   ├── server.ts
│   ├── worker.ts
│   ├── controllers/
│   │   └── job.controller.ts
│   ├── queues/
│   │   └── job.queue.ts
│   ├── routes/
│   │   └── job.routes.ts
│   └── services/
│       ├── cron.service.ts
│       ├── job_processor.service.ts
│       ├── scheduler.service.ts
│       ├── worker.service.ts
│       ├── worker_heartbeat.service.ts
│       └── worker_monitor.service.ts
├── dist/
├── node_modules/
├── package-lock.json
└── README.md
```

## Docker and local runtime

### Start the infrastructure with Docker Compose

```bash
docker compose up -d --build
```

This starts:

- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- API on `localhost:8000`
- Scheduler process
- Worker process
- Monitor process

### Local development commands

Install dependencies:

```bash
npm install
```

Initialize the PostgreSQL schema:

```bash
npm run db:init
```

Start the API in watch mode:

```bash
npm run dev
```

Start the scheduler:

```bash
npm run scheduler
```

Start the worker:

```bash
npm run worker
```

Start the monitor:

```bash
npm run monitor
```

Build production JS:

```bash
npm run build
```

Run the compiled API server:

```bash
npm start
```

## Environment variables

The project relies on the following environment values:

| Variable | Purpose | Typical value |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the API, scheduler, worker, and monitor | `postgresql://flow:flow@localhost:5432/flow` |
| `REDIS_URL` | Redis connection string for BullMQ | `redis://localhost:6379` |
| `PORT` | API port | `8000` |
| `WORKER_ID` | Optional explicit worker identity | Hostname + UUID suffix |

The `.env` file used locally looks like this:

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

### Worker concurrency per process

Each worker process runs with `concurrency: 3`, which allows multiple jobs to execute in parallel inside a single worker instance while still keeping the system simple. This is enough to demonstrate scale-out behavior without introducing more explicit resource quotas or orchestration policies.

### Process-level command execution

The actual task command is executed with Node's `child_process.exec()`. This is simple and direct, but it is also a trust boundary. The implementation is intentionally not hardened against arbitrary command injection or untrusted job definitions.

## Failure scenarios and current handling

### Job fails once

The worker catches the command failure, writes to `job_logs`, marks the job as `QUEUED` if retries remain, and rethrows the error so BullMQ can handle the retry.

### Worker crashes mid-job

The worker monitor checks heartbeats. If the worker stops heartbeating, the monitor marks it offline and inspects the jobs it was running. If BullMQ still owns the job, it leaves it alone; otherwise it requeues the job or marks it failed if retries are exhausted.

### Job is cancelled while pending or queued

`POST /jobs/:id/cancel` marks the PostgreSQL row as `CANCELLED` and removes the BullMQ job if it exists.

### Recurring job needs a new schedule

On successful completion, the recurring job is reset to `PENDING` and `next_run_at` is advanced by `calculateNextRun()`, using the cron spec and the current time.

### A job exhausts its retries

The worker updates the job to `FAILED` and stores the last error in `error`.

## Future improvements

The current codebase is a solid foundation, but several production-grade improvements are still missing or intentionally simple:

- stronger job idempotency and deduplication keys
- result payload storage for completed work
- explicit job timeout and cancellation of stuck shell commands
- dead-letter queue handling for permanently failed jobs
- richer job dependency and fan-out orchestration
- queue rate limits / concurrency quotas per job type
- dashboard or admin UI for jobs and worker health
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
docker compose up -d --build
npm run db:init
npm run dev
npm run scheduler
npm run worker
npm run monitor
```

Then interact with the API at `http://localhost:8000`.

For example:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/jobs
```

## Final note

This README is based on the actual implementation in the repository. The project is a real operating job system with a PostgreSQL-backed state machine, Redis/BullMQ queueing, worker execution, retries, and monitoring rather than a hypothetical design document.