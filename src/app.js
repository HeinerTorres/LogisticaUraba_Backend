import express from "express";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "./database.js";
import { resendVerificationEmail } from "./emailService.js";
import userRoutes from "../routes/users.js";
import packageRoutes from "../routes/packages_fixed.js";
import authRoutes from "../routes/auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

// ================================================
// 🔐 TOKEN TEMPORAL (2FA)
// ================================================
const tokens = {};
const verifiedSessions = {};

app.post("/api/send-token", (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Falta el correo electrónico" });
  }

  const token = crypto.randomInt(100000, 999999).toString();
  tokens[email] = {
    token,
    expires: Date.now() + 2 * 60 * 1000, // 2 minutos
  };

  console.log(`🔐 Token generado para ${email}: ${token}`);

  res.json({
    success: true,
    message: "✅ Token generado correctamente",
    token,
    expiresIn: "2 minutos",
  });
});

app.post("/api/verify-token", async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ error: "Email y token son requeridos" });
    }

    const record = tokens[email];

    if (!record) {
      return res
        .status(400)
        .json({
          error: "No se encontró token para este correo. Genera uno nuevo.",
        });
    }

    if (record.expires < Date.now()) {
      delete tokens[email];
      return res
        .status(400)
        .json({ error: "Token caducado. Genera uno nuevo." });
    }

    if (record.token !== token) {
      return res.status(400).json({ error: "Código inválido" });
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    verifiedSessions[sessionId] = {
      email,
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 horas
    };

    delete tokens[email];

    res.json({
      success: true,
      message:
        "✅ Código verificado correctamente. Ahora puedes iniciar sesión.",
      session_id: sessionId,
    });
  } catch (error) {
    console.error("Error verificando token:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ================================================
// 🔑 LOGIN CON SESIÓN TEMPORAL
// ================================================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, session_id } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email y contraseña son requeridos" });
    }

    const userResult = await pool.query(
      `SELECT id, first_name, second_name, last_name, second_last_name, document_number,
              email, address, phone, role, is_email_verified, password_hash
         FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const user = userResult.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const isPermanentlyVerified = user.is_email_verified;
    const hasValidSession =
      session_id &&
      verifiedSessions[session_id] &&
      verifiedSessions[session_id].email === email &&
      verifiedSessions[session_id].expires > Date.now();

    if (!isPermanentlyVerified && !hasValidSession) {
      return res.status(403).json({
        error: "Email no verificado",
        requires_token: true,
        message:
          "Por favor verifica tu email o usa un token temporal para acceder",
      });
    }

    if (!isPermanentlyVerified && hasValidSession) {
      console.log(`🔐 Usuario ${email} accediendo con sesión temporal`);
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        is_temporary: !isPermanentlyVerified,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: "Login exitoso",
      token,
      user: userWithoutPassword,
      is_temporary: !isPermanentlyVerified,
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ================================================
// 📧 REENVIAR CORREO DE VERIFICACIÓN
// ================================================
app.post("/api/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email es requerido" });
    }

    const userResult = await pool.query(
      "SELECT id, first_name, last_name, is_email_verified FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = userResult.rows[0];
    if (user.is_email_verified) {
      return res.status(400).json({ error: "El email ya está verificado" });
    }

    const newVerificationToken = crypto.randomBytes(32).toString("hex");

    await pool.query("UPDATE users SET verification_token = $1 WHERE id = $2", [
      newVerificationToken,
      user.id,
    ]);

    const emailSent = await resendVerificationEmail(
      email,
      newVerificationToken,
      `${user.first_name} ${user.last_name}`
    );

    if (emailSent) {
      res.json({
        success: true,
        message: "✅ Correo de verificación reenviado exitosamente",
      });
    } else {
      res.status(500).json({
        success: false,
        error: "❌ Error reenviando correo de verificación",
      });
    }
  } catch (error) {
    console.error("❌ Error reenviando verificación:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor",
    });
  }
});

// ================================================
// 📦 RUTAS IMPORTADAS
// ================================================
app.use("/api/users", userRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/auth", authRoutes);

// ================================================
// 🧪 RUTAS DE PRUEBA
// ================================================
app.get("/", (req, res) => {
  res.json({
    message: "¡Backend de Logística Urabá funcionando!",
    status: "OK",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    database: "PostgreSQL",
    project: "Logística Segura Urabá",
  });
});

// ================================================
// 🔄 LIMPIAR SESIONES EXPIRADAS
// ================================================
function cleanupExpiredSessions() {
  const now = Date.now();
  Object.keys(verifiedSessions).forEach((key) => {
    if (verifiedSessions[key].expires < now) {
      delete verifiedSessions[key];
    }
  });
}

setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// ================================================
// 🚀 INICIAR SERVIDOR
// ================================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

export default app;
