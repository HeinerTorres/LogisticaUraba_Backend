import pkg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pkg;

let pool;

if (process.env.NODE_ENV === "production") {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log("🌐 Conectando a la base de datos remota en Render...");
} else {
  pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || "logistica_uraba",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "admin",
  });
  console.log("💻 Conectando a la base de datos local...");
}

pool.on("connect", () =>
  console.log("✅ Conectado a PostgreSQL correctamente")
);
pool.on("error", (err) => console.error("❌ Error en la conexión:", err));

export default pool;
