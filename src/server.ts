import dotenv from "dotenv";
import app from "./app.js";

dotenv.config();

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`FLOW API running on port ${PORT}`);
});