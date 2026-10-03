import os from "os";
import crypto from "crypto";
import { pool } from "../db.js";
// --------------------------------------------------
// Worker identity
//
// Every worker process gets its own unique ID.
// This becomes important when we later add
// worker heartbeats and failure recovery.
// --------------------------------------------------

export const workerId =
  process.env.WORKER_ID ||
  `${os.hostname()}-${crypto.randomUUID().slice(0, 8)}`;

console.log(`Worker ID: ${workerId}`);

// --------------------------------------------------
// Register worker in PostgreSQL
// --------------------------------------------------

export const registerWorker = async () => {
  await pool.query(
    `
    INSERT INTO workers (
      worker_id,
      status,
      last_heartbeat,
      started_at,
      updated_at
    )
    VALUES ($1, 'ONLINE', NOW(), NOW(), NOW())

    ON CONFLICT (worker_id)
    DO UPDATE SET
      status = 'ONLINE',
      last_heartbeat = NOW(),
      updated_at = NOW()
    `,
    [workerId],
  );

  console.log(`[${workerId}] Worker registered in PostgreSQL`);
};

// --------------------------------------------------
// Worker heartbeat
//
// The worker periodically tells PostgreSQL that it
// is still alive.
// --------------------------------------------------

export const startHeartbeat = () => {
  setInterval(async () => {
    try {
      await pool.query(
        `
        UPDATE workers
        SET
          last_heartbeat = NOW(),
          status = 'ONLINE',
          updated_at = NOW()
        WHERE worker_id = $1
        `,
        [workerId],
      );

      console.log(`[${workerId}] Heartbeat`);
    } catch (error) {
      console.error(`[${workerId}] Heartbeat failed:`, error);
    }
  }, 5000);
};