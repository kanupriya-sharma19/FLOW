import type { Request, Response } from "express";
import { pool } from "../db.js";

// READ ALL WORKERS
export const getWorkers = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM workers
      ORDER BY last_heartbeat DESC
      `,
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch workers:", error);

    return res.status(500).json({
      error: "Failed to fetch workers",
    });
  }
};