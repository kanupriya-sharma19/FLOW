import express from "express";
import cors from "cors";
import jobRoutes from "./routes/job.routes.js";

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
export default app;