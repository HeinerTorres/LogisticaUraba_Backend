import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(cors());

const tokens = {};

// 🔹 Generar token temporal
app.post("/api/send-token", (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Falta el correo" });

  const token = crypto.randomInt(100000, 999999).toString();

  // Expira en 5 minutos
  tokens[email] = { token, expires: Date.now() + 5 * 60 * 1000 };

  console.log(`🔐 Token generado para ${email}: ${token}`);

  res.json({ message: "Token generado (revisa la consola del servidor)" });
});

// 🔹 Validar token
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Servidor activo en puerto ${PORT}`));
