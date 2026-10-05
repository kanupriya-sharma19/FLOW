import dotenv from "dotenv";
import { startScheduler } from "./scheduler.service.js";

dotenv.config();

console.log("FLOW Scheduler starting...");

startScheduler();
