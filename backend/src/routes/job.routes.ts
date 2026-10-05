import { Router } from "express";
import multer from "multer";

import {
  createJob,
  getJobs,
  getJob,
  updateJob,
  deleteJob,
  cancelJob,
  queueJobs,
  getJobExecutions,
  getJobLogs,
} from "../controllers/job.controller.js";

const router = Router();

const upload = multer({
  dest: "uploads/",
});

router.post("/", upload.single("file"), createJob);

router.get("/", getJobs);

router.post("/queue", queueJobs);

router.get("/:id/executions", getJobExecutions);

router.get("/:id/logs", getJobLogs);

router.get("/:id", getJob);

router.patch("/:id", updateJob);

router.delete("/:id", deleteJob);

router.post("/:id/cancel", cancelJob);

export default router;