import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client } = pg;

const config = {
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "admin",
  database: "postgres",
};

async function setupDatabase() {
  const client = new Client(config);

  try {
    await client.connect();
    console.log("✅ Conectado a PostgreSQL");

    try {
      await client.query("CREATE DATABASE logistica_uraba;");
      console.log('✅ Base de datos "logistica_uraba" creada');
    } catch (error) {
      if (error.code === "42P04") {
        console.log("ℹ️  La base de datos ya existe");
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error("❌ Error creando base de datos:", error.message);
    return;
  } finally {
    await client.end();
  }

  const dbClient = new Client({
    ...config,
    database: "logistica_uraba",
  });

  try {
    await dbClient.connect();
    console.log("✅ Conectado a la base de datos logistica_uraba");

    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        second_name VARCHAR(100),
        last_name VARCHAR(100) NOT NULL,
        second_last_name VARCHAR(100),
        document_number VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        address TEXT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        role VARCHAR(20) DEFAULT 'client',
        is_email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla "users" creada');

    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id SERIAL PRIMARY KEY,
        tracking_code VARCHAR(100) UNIQUE NOT NULL,
        sender_name VARCHAR(255) NOT NULL,
        recipient_name VARCHAR(255) NOT NULL,
        delivery_address TEXT NOT NULL,
        weight DECIMAL(10,2),
        cost DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'Registrado',
        client_id INTEGER REFERENCES users(id),
        assigned_messenger_id INTEGER REFERENCES users(id),
        qr_code_data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla "packages" creada');

    const userCheck = await dbClient.query(
      "SELECT COUNT(*) FROM users WHERE document_number = $1",
      ["12345678"]
    );

    if (parseInt(userCheck.rows[0].count) === 0) {
      await dbClient.query(
        `INSERT INTO users 
          (first_name, last_name, document_number, email, address, phone, role) 
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          "Juan",
          "Pérez",
          "12345678",
          "juan@example.com",
          "Calle 123, Urabá",
          "3001234567",
          "client",
        ]
      );
      console.log("✅ Usuario de prueba insertado");
    } else {
      console.log("ℹ️  Usuario de prueba ya existe");
    }

    console.log("🎉 Base de datos configurada correctamente!");
  } catch (error) {
    console.error("❌ Error configurando base de datos:", error.message);
  } finally {
    await dbClient.end();
  }
}

setupDatabase();
