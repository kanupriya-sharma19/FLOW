import { pool } from "./db.js";

const testDatabase = async () => {
  try {
    const result = await pool.query("SELECT current_user, current_database(), NOW()");

    console.log("✅ Connected to PostgreSQL");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(error);
  } finally {
    await pool.end();
  }
};

testDatabase();