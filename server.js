import express from "express";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import userRoutes from "./routes/users.js"; // importa tus rutas de usuario
import pool from "./database.js"; // importa la conexión a la DB

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// 🧩 Prueba conexión a la DB
pool
  .connect()
  .then(() => console.log("✅ Conexión con PostgreSQL exitosa"))
  .catch((err) => console.error("❌ Error conectando a PostgreSQL:", err));

// 🔹 Rutas principales
app.use("/api/users", userRoutes);

// 🔹 Token temporal (si todavía lo usas)
const tokens = {};

app.post("/api/send-token", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Falta el correo" });

  const token = crypto.randomInt(100000, 999999).toString();
  tokens[email] = { token, expires: Date.now() + 5 * 60 * 1000 };
  console.log(`🔐 Token generado para ${email}: ${token}`);
  res.json({ message: "Token generado (revisa la consola del servidor)" });
});

app.post("/api/verify-token", (req, res) => {
  const { email, token } = req.body;
  const record = tokens[email];

  if (!record)
    return res
      .status(400)
      .json({ error: "No se encontró token para este correo" });
  if (record.expires < Date.now()) {
    delete tokens[email];
    return res.status(400).json({ error: "Token caducado" });
  }
  if (record.token !== token)
    return res.status(400).json({ error: "Código inválido" });

  delete tokens[email];
  res.json({ message: "Acceso concedido ✅" });
});

// 🔹 Ruta base para probar
app.get("/", (req, res) => {
  res.send("🚀 Backend Logística Urabá activo y conectado");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));
