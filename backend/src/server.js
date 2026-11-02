import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
// import authRoutes from "./routes/auth.route.js";
// import { notFound, errorHandler } from "./middleware/error.middleware.js";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

app.get("/", (req, res) => res.json({ message: "Auth API is running" }));
// app.use("/api/auth", authRoutes);

// app.use(notFound);
// app.use(errorHandler);

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
