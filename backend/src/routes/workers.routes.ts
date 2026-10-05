import { Router } from "express";

import {
getWorkers
} from "../controllers/workers.controller.js";

const router = Router();
router.get("/", getWorkers);
export default router;