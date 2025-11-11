import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client } = pg;

const config = {
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "logistica_uraba",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "admin",
};

async function createTestUsers() {
  const client = new Client(config);

  try {
    await client.connect();
    console.log("✅ Conectado a PostgreSQL");

    const operatorResult = await client.query(
      `
      INSERT INTO users 
      (first_name, last_name, document_number, email, address, phone, role) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (document_number) DO NOTHING
      RETURNING id, first_name, last_name, role
      `,
      [
        "Laura",
        "Operaria",
        "111222333",
        "laura.operaria@logistica.com",
        "Oficina Central, Apartadó",
        "3011112233",
        "operator",
      ]
    );

    if (operatorResult.rows.length > 0) {
      console.log("✅ Operario de prueba creado:", operatorResult.rows[0]);
    } else {
      console.log("ℹ️ Operario ya existe");
    }

    const messengerResult = await client.query(
      `
      INSERT INTO users 
      (first_name, last_name, document_number, email, address, phone, role) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (document_number) DO NOTHING
      RETURNING id, first_name, last_name, role
      `,
      [
        "Pedro",
        "Mensajero",
        "444555666",
        "pedro.mensajero@logistica.com",
        "Base Mensajeros, Turbo",
        "3024445566",
        "messenger",
      ]
    );

    if (messengerResult.rows.length > 0) {
      console.log("✅ Mensajero de prueba creado:", messengerResult.rows[0]);
    } else {
      console.log("ℹ️ Mensajero ya existe");
    }

    console.log("🎉 Proceso completado!");
  } catch (error) {
    console.error("❌ Error general:", error.message);
  } finally {
    await client.end();
  }
}

createTestUsers();
