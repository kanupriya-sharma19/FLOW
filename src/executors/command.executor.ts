import { spawn } from "child_process";

import type {
  Job,
  ExecutionResult,
} from "../types/job.types.js";

const EXECUTION_TIMEOUT_MS = 30_000;

export const executeCommand = (job: Job): Promise<ExecutionResult> => {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    if (!job.command) {
      reject(new Error("Command job has no command"));
      return;
    }

    const child = spawn(job.command, {
      shell: true,
      env: {
        ...process.env,
        FLOW_ATTEMPT: String(job.attempts),
      },
    });

    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;

      console.log(
        `Python job ${job.name} exceeded execution timeout of ${EXECUTION_TIMEOUT_MS}ms`,
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

    child.on("error", (error) => {
      reject({
        message: error.message,
        stdout,
        stderr,
        exitCode: null,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject({
          message: `Python process exceeded execution timeout of ${
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
          message: `Python process exited with code ${code}`,
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      }
    });
  });
};
