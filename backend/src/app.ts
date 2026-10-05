import express from "express";
import cors from "cors";
import jobRoutes from "./routes/job.routes.js";
import workerRoutes from "./routes/workers.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "flow-api",
  });
});
app.use("/jobs", jobRoutes);
app.use("/workers", workerRoutes);
export default app;