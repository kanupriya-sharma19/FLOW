import dotenv from "dotenv";
import app from "./app.js";
import { startScheduler } from "./services/scheduler.service.js";
import { startWorker } from "./services/worker.service.js";

dotenv.config();

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`FLOW API running on port ${PORT}`);
  startScheduler();
  startWorker();
});