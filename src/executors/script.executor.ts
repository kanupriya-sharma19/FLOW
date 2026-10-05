

import { spawn } from "child_process";

import type {
  Job,
  ExecutionResult,
} from "../types/job.types.js";

const EXECUTION_TIMEOUT_MS = 30_000;
// ==================================================
// 7. EXECUTE SCRIPT FILE
//
// Supports:
// - PYTHON → python3
// - NODE   → node
//
// Temporary implementation.
//
// This executes scripts directly on the worker machine.
// We will replace this with isolated containers next.
// ==================================================

export const executeScriptFile = (job: Job): Promise<ExecutionResult> => {
  return new Promise((resolve, reject) => {
    
    if (!job.file_path) {
      reject(new Error("File job has no file_path"));
      return;
    }

    let executable: string;

    switch (job.runtime) {
      case "PYTHON":
        executable = "python3";
        break;

      case "NODE":
        executable = "node";
        break;

      default:
        reject(new Error(`Unsupported file runtime: ${job.runtime}`));
        return;
    }

    let stdout = "";
    let stderr = "";

    const child = spawn(executable, [job.file_path], {
      shell: false,
      env: {
        ...process.env,
        FLOW_ATTEMPT: String(job.attempts),
      },
    });

    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;

      console.log(
        `${job.runtime} job ${job.name} exceeded execution timeout of ${EXECUTION_TIMEOUT_MS}ms`,
      );

      child.kill();
    }, EXECUTION_TIMEOUT_MS);

    child.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      console.log("stdout:", output);
    });

    child.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      console.log("stderr:", output);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject({
          message: `${job.runtime} process exceeded execution timeout of ${
            EXECUTION_TIMEOUT_MS / 1000
          } seconds`,
          stdout,
          stderr,
          exitCode: null,
        });

        return;
      }

      if (code === 0) {
        resolve({
          stdout,
          stderr,
          exitCode: 0,
        });
      } else {
        reject({
          message: `${job.runtime} process exited with code ${code}`,
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      }
    });
  });
};