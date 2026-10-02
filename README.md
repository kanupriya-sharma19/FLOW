# FLOW - Job Scheduling System

FLOW is a basic job scheduling system built as a learning-oriented proof of concept (POC).

The goal is to understand how a job scheduler works internally:

- Creating jobs
- Persisting jobs in PostgreSQL
- Scheduling pending jobs
- Queuing jobs
- Picking jobs with a worker
- Executing real OS commands
- Tracking job status
- Handling successful and failed jobs
- Cancelling jobs

Redis, BullMQ, distributed workers, retries, concurrency control, and similar production concerns are intentionally not implemented yet. They will be introduced incrementally after the fundamentals are understood.

---

## 1. Current Architecture

```text
                              +------------------+
                              |      Client      |
                              | Postman / API    |
                              +---------+--------+
                                        |
                                        v
                              +------------------+
                              |   Express API    |
                              |                  |
                              | Create Job       |
                              | Get Job          |
                              | Update Job       |
                              | Delete Job       |
                              | Cancel Job       |
                              +---------+--------+
                                        |
                                        v
                              +------------------+
                              |   PostgreSQL     |
                              |                  |
                              |      jobs        |
                              |                  |
                              | PENDING          |
                              | QUEUED           |
                              | RUNNING          |
                              | COMPLETED        |
                              | FAILED           |
                              | CANCELLED        |
                              +---------+--------+
                                        |
                  +---------------------+---------------------+
                  |                                            |
                  v                                            v
          +----------------+                         +----------------+
          |   Scheduler    |                         |    Worker      |
          |                |                         |                |
          | PENDING        |                         | QUEUED         |
          |       v        |                         |       v        |
          |  QUEUED        |                         |  RUNNING       |
          +----------------+                         |       v        |
                                                    | execute()      |
                                                    |       v        |
                                                    | COMPLETED /    |
                                                    | FAILED         |
                                                    +----------------+
```

Currently PostgreSQL acts as both:

1. Persistent storage
2. Temporary job queue

Later, Redis/BullMQ can be introduced to handle job distribution more reliably.

---

## 2. Tech Stack

### Backend

- Node.js
- TypeScript
- Express.js

### Database

- PostgreSQL 17
- `pg` Node.js PostgreSQL client

### Development

- `tsx`
- Docker
- Docker Compose
- Postman / REST client

---

## 3. Project Structure

```text
FLOW/
|-- src/
|   |-- app.ts
|   |-- server.ts
|   |-- db.ts
|   |-- test-db.ts
|   |-- routes/
|   |   |-- job.routes.ts
|   |-- controllers/
|   |   |-- job.controller.ts
|   |-- services/
|       |-- scheduler.service.ts
|       |-- worker.service.ts
|-- .env
|-- package.json
|-- tsconfig.json
|-- docker-compose.yml
|-- README.md
```

`test-db.ts` was used during initial database connection testing and can eventually be removed.

---

## 4. PostgreSQL Setup

PostgreSQL is running inside Docker.

Container:

```text
flow-postgres
```

Image:

```text
postgres:17
```

Database:

```text
flow
```

Username:

```text
flow
```

Password:

```text
flow
```

Port:

```text
5432
```

The database is available at:

```text
localhost:5432
```

---

## 5. PostgreSQL Installation Issue

PostgreSQL 18 was also installed natively on Windows.

This caused a port conflict because:

```text
Windows PostgreSQL -> localhost:5432
Docker PostgreSQL  -> localhost:5432
```

Only one process can listen on the same port.

We discovered that the Windows PostgreSQL process was occupying port 5432.

The Windows PostgreSQL service was therefore changed to:

```text
Startup Type: Manual
```

and stopped.

This allows Docker PostgreSQL to own port 5432 during development.

pgAdmin can still be used later to connect to the Docker PostgreSQL instance.

---

## 6. Environment Variables

The `.env` file currently contains:

```env
DATABASE_URL="postgresql://flow:flow@localhost:5432/flow"
PORT=8000
```

The application uses `DATABASE_URL` to connect to PostgreSQL.

---

## 7. Database Connection

The PostgreSQL connection is created using `pg`.

```ts
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

The connection was tested successfully.

Example result:

```text
Connected to PostgreSQL
current_user: flow
current_database: flow
```

---

## 8. Jobs Table

The main table is:

```text
jobs
```

Schema:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  command TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error TEXT
);
```

---

## 9. Meaning of Job Fields

### `id`

Unique identifier for the job.

Example:

```text
550e8400-e29b-41d4-a716-446655440000
```

### `name`

Human-readable job name.

Example:

```text
create-folder
```

### `command`

The actual operating-system command that the worker will execute.

Example:

```text
echo Hello FLOW
```

or:

```text
mkdir test-folder
```

### `priority`

Determines which queued job should be processed first.

Higher priority is processed first.

Example:

```text
priority = 10
```

will be selected before:

```text
priority = 1
```

### `status`

Current state of the job.

Possible states currently used:

```text
PENDING
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
```

### `attempts`

Number of execution attempts.

Currently the field exists, but retry logic has not yet been implemented.

### `max_attempts`

Maximum number of attempts allowed.

Currently defaults to:

```text
3
```

Retry behavior will be implemented later.

### `created_at`

When the job was created.

### `updated_at`

Last time the job record was updated.

### `started_at`

When the worker started executing the job.

### `completed_at`

When the job completed successfully.

### `error`

Stores the error message when execution fails.

---

## 10. Job Lifecycle

The current job lifecycle is:

```text
PENDING
  |
  v
QUEUED
  |
  v
RUNNING
  |
  +------------------> COMPLETED
  |
  +------------------> FAILED
```

Cancellation is possible before execution:

```text
PENDING --------> CANCELLED
QUEUED ---------> CANCELLED
```

The API does not directly control execution states such as:

```text
RUNNING
COMPLETED
FAILED
```

Those states are controlled by the scheduler and worker.

---

## 11. Express Application

`app.ts` creates the Express application.

```ts
const app = express();

app.use(cors());
app.use(express.json());
```

A health endpoint exists:

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

Job routes are mounted under:

```text
/jobs
```

---

## 12. API Endpoints

### Create Job

```http
POST /jobs
```

Example body:

```json
{
  "name": "hello-job",
  "command": "echo Hello FLOW",
  "priority": 1,
  "maxAttempts": 3
}
```

New jobs start with:

```text
PENDING
```

### Get All Jobs

```http
GET /jobs
```

Returns all jobs ordered by creation time.

### Get One Job

```http
GET /jobs/:id
```

Example:

```http
GET /jobs/550e8400-e29b-41d4-a716-446655440000
```

### Update Job

```http
PATCH /jobs/:id
```

Currently metadata can be updated:

- name
- command
- priority
- maxAttempts

The API intentionally does not allow directly changing execution status.

For example, clients should not be able to do:

```json
{
  "status": "COMPLETED"
}
```

The worker is responsible for execution state.

### Delete Job

```http
DELETE /jobs/:id
```

Deletes the job from PostgreSQL.

### Cancel Job

```http
POST /jobs/:id/cancel
```

A job can be cancelled when it is:

```text
PENDING
```

or:

```text
QUEUED
```

A running or completed job cannot simply be cancelled through this endpoint.

---

## 13. Scheduler

The scheduler is implemented in:

```text
src/services/scheduler.service.ts
```

The scheduler periodically checks PostgreSQL.

Current behavior:

```text
Every 5 seconds
      v
Find PENDING jobs
      v
Change them to QUEUED
```

The main query is:

```sql
UPDATE jobs
SET
  status = 'QUEUED',
  updated_at = NOW()
WHERE status = 'PENDING'
RETURNING *;
```

Therefore:

```text
PENDING -> QUEUED
```

The scheduler currently queues all pending jobs.

This is intentionally simple for the POC.

---

## 14. Worker

The worker is implemented in:

```text
src/services/worker.service.ts
```

The worker checks PostgreSQL every 2 seconds.

Its flow is:

```text
Find QUEUED job
      v
Select highest priority
      v
Mark RUNNING
      v
Execute command
      v
Success?
   /       Yes      No
  v        v
COMPLETED  FAILED
```

---

## 15. Selecting a Job

The worker currently uses:

```sql
SELECT *
FROM jobs
WHERE status = 'QUEUED'
ORDER BY priority DESC, created_at ASC
LIMIT 1;
```

This means:

1. Higher priority jobs are selected first.
2. If priority is equal, older jobs are selected first.

Example:

```text
Job A -> priority 1
Job B -> priority 10
Job C -> priority 5
```

The worker will select:

```text
Job B
```

first.

---

## 16. Running a Job

After selecting a job, the worker changes:

```text
QUEUED -> RUNNING
```

It also records:

```text
started_at
```

Then it executes:

```ts
exec(job.command)
```

Node's `child_process.exec()` sends the command to the operating system.

---

## 17. Real Command Execution

This is an important part of FLOW.

The worker is not just pretending to execute commands.

For example, if a job contains:

```json
{
  "name": "create-folder",
  "command": "mkdir test-folder"
}
```

then the worker actually executes:

```bash
mkdir test-folder
```

on the machine running the worker.

So FLOW can perform real operating-system operations.

Another example:

```json
{
  "name": "hello-job",
  "command": "echo Hello FLOW"
}
```

The worker executes:

```bash
echo Hello FLOW
```

and receives:

```text
Hello FLOW
```

as stdout.

---

## 18. Successful Execution

If the operating system successfully executes the command:

```text
RUNNING
  v
COMPLETED
```

The worker updates:

```text
completed_at
updated_at
```

and logs the job completion.

---

## 19. Failed Execution

The worker does not know beforehand whether a command is valid.

For example:

```text
this-command-does-not-exist
```

The worker passes it to the operating system.

If execution fails, `exec()` rejects or throws an error.

The worker catches it and changes:

```text
RUNNING
  v
FAILED
```

The error message is stored in:

```text
error
```

---

## 20. stdout and stderr

The worker receives:

```text
stdout
stderr
```

from the command.

### `stdout`

Normal output.

Example:

```bash
echo Hello
```

produces:

```text
Hello
```

in stdout.

### `stderr`

Error or warning output.

Important:

`stderr` by itself does not necessarily mean the command failed.

The current worker uses whether `exec()` rejects as the primary indication of execution failure.

---

## 21. Starting the Application

Development mode:

```bash
npm run dev
```

This runs:

```text
tsx watch src/server.ts
```

and automatically restarts when source files change.

---

## 22. Build

To compile TypeScript:

```bash
npm run build
```

This uses:

```text
tsc
```

and generates compiled JavaScript according to the TypeScript configuration.

---

## 23. Production-Style Start

After building:

```bash
npm start
```

This runs the compiled JavaScript:

```text
node dist/server.js
```

---

## 24. Current Server Startup

When the server starts:

```text
FLOW API running on port 8000
Scheduler started
Worker started
```

The server starts:

```text
Express API
Scheduler
Worker
```

all within the current application.

---

## 25. Example Complete Flow

Suppose we create:

```json
{
  "name": "create-folder",
  "command": "mkdir test-folder"
}
```

The flow becomes:

```text
POST /jobs
      |
      v
PostgreSQL
      |
      v
PENDING
      |
      | Scheduler
      v
QUEUED
      |
      | Worker
      v
RUNNING
      |
      | exec("mkdir test-folder")
      v
Operating System
      |
      v
Folder created
      |
      v
COMPLETED
```

The folder is actually created on the machine running FLOW.

---

## 26. Why PostgreSQL Is Currently the Queue

For this POC, we intentionally avoided Redis/BullMQ.

PostgreSQL currently handles:

```text
Persistent storage
      +
Basic queue
```

The worker asks PostgreSQL:

```text
"Do you have a QUEUED job?"
```

If one exists, it processes it.

This is useful for understanding the basic architecture before introducing a dedicated queue.

---

## 27. Current Limitations

This is a learning POC, so several production concerns are intentionally not solved yet.

### 1. PostgreSQL polling

The worker repeatedly queries PostgreSQL instead of using a dedicated queue.

### 2. No retry mechanism

`attempts` and `max_attempts` exist in the database, but retry behavior has not yet been implemented.

### 3. Basic concurrency

The current worker is effectively a single simple polling worker.

Multiple workers could potentially pick the same job because there is no database locking mechanism yet.

### 4. Scheduler queues everything

The scheduler currently changes all:

```text
PENDING -> QUEUED
```

without batching or more advanced scheduling rules.

### 5. No job timeout

A command that runs for a very long time can keep the worker busy.

### 6. No sandboxing

The worker executes shell commands directly on the machine.

For example:

```text
mkdir test-folder
```

actually changes the filesystem.

Therefore the current API must only be used with trusted commands.

### 7. No distributed workers

Everything currently runs inside the same application process.

---

## 28. Important Security Warning

This part is extremely important.

The current worker executes:

```ts
exec(job.command)
```

Therefore, if an untrusted user can submit arbitrary commands, they could potentially execute arbitrary operating-system commands.

For example, this is not safe for a public API.

The current implementation should therefore be treated as:

```text
LOCAL LEARNING POC
```

and not as a production job execution system.

A production version would require isolation, authentication, authorization, sandboxing/containers, resource limits, timeouts, and other security controls.

---

## 29. What We Have Learned So Far

The current POC demonstrates the fundamental job execution lifecycle:

```text
Create
  v
Persist
  v
Schedule
  v
Queue
  v
Pick
  v
Run
  v
Complete / Fail
```

We have also separated responsibilities:

### API

Responsible for:

```text
Create
Read
Update metadata
Delete
Cancel
```

### Scheduler

Responsible for:

```text
PENDING -> QUEUED
```

### Worker

Responsible for:

```text
QUEUED -> RUNNING
RUNNING -> COMPLETED
RUNNING -> FAILED
FAILED -> QUEUED (when retry is available)
```

### PostgreSQL

Responsible for:

```text
Persistent job state
```

and currently also:

```text
Temporary queue
```

---

## 30. Planned Next Steps

The next improvements can be introduced one at a time.

Possible progression:

```text
Current POC
    |
    v
Retry mechanism
    |
    v
Job timeout
    |
    v
Concurrency control
    |
    v
Multiple workers
    |
    v
Redis
    |
    v
BullMQ
    |
    v
Reliable distributed job processing
```

The goal is to understand why each component is needed rather than adding technologies without understanding their purpose.

---

## 31. Current Status

### Completed

- [x] Node.js + TypeScript project
- [x] Express server
- [x] PostgreSQL Docker setup
- [x] Database connection using `pg`
- [x] Jobs table
- [x] Job creation
- [x] Get all jobs
- [x] Get individual job
- [x] Update job metadata
- [x] Delete job
- [x] Cancel job
- [x] Job status lifecycle
- [x] Scheduler
- [x] PENDING -> QUEUED
- [x] Worker
- [x] QUEUED -> RUNNING
- [x] Real command execution
- [x] RUNNING -> COMPLETED
- [x] RUNNING -> FAILED
- [x] Error storage
- [x] Priority-based job selection

### Not implemented yet

- [ ] Retries
- [ ] Timeouts
- [ ] Concurrency control
- [ ] Multiple workers
- [ ] Redis
- [ ] BullMQ
- [ ] Distributed processing
- [ ] Worker isolation
- [ ] Authentication/authorization
- [ ] Production-grade security
- [ ] Monitoring
- [ ] Dead-letter queue
- [ ] Job dependencies

---

## Final note

The current implementation is intentionally simple.

The main purpose of this project is to understand how a job scheduling system works internally before introducing production-grade components such as Redis, BullMQ, distributed workers, and job execution isolation.

This README reflects exactly where FLOW is right now, including the fact that the worker can actually execute `mkdir test-folder` on your machine.
