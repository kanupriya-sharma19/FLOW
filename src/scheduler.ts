import dotenv from "dotenv";
import { startScheduler } from "./services/scheduler.service.js";

dotenv.config();

console.log("FLOW Scheduler starting...");

startScheduler();