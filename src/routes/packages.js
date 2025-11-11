import express from "express";
import pool from "../services/database.js";
import { authenticateToken } from "../middleware/auth.js";
import qr from "qr-image";

const router = express.Router();

// HU4: Registrar nuevo envío
router.post("/register", async (req, res) => {
  try {
    const { sender_name, recipient_name, delivery_address, weight, client_id } =
      req.body;

    if (!sender_name || !recipient_name || !delivery_address || !client_id) {
      return res.status(400).json({
        error:
          "Faltan campos obligatorios: remitente, destinatario, dirección, cliente",
      });
    }

    const tracking_code = `URABA-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 5)
      .toUpperCase()}`;

    const baseCost = 10000;
    const costPerKg = 5000;
    const cost = weight ? baseCost + parseFloat(weight) * costPerKg : baseCost;

    console.log("Registrando envío:", {
      tracking_code,
      sender_name,
      recipient_name,
      cost,
    });

    const result = await pool.query(
      `INSERT INTO packages 
       (tracking_code, sender_name, recipient_name, delivery_address, weight, cost, client_id, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, tracking_code, sender_name, recipient_name, delivery_address, cost, status, created_at`,
      [
        tracking_code,
        sender_name,
        recipient_name,
        delivery_address,
        weight,
        cost,
        client_id,
        "registered",
      ]
    );

    res.status(201).json({
      message: "Envío registrado exitosamente",
      package: result.rows[0],
    });
  } catch (error) {
    console.error("Error registrando envío:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor: " + error.message });
  }
});

// Obtener todos los envíos
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
          p.*, 
          u.first_name || ' ' || u.last_name as client_name,
          m.first_name || ' ' || m.last_name as messenger_name
      FROM packages p 
      LEFT JOIN users u ON p.client_id = u.id
      LEFT JOIN users m ON p.assigned_messenger_id = m.id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener envío por código de seguimiento
router.get("/tracking/:tracking_code", async (req, res) => {
  try {
    const { tracking_code } = req.params;

    const result = await pool.query(
      `
      SELECT 
          p.*, 
          u.first_name || ' ' || u.last_name as client_name,
          m.first_name || ' ' || m.last_name as messenger_name
      FROM packages p 
      LEFT JOIN users u ON p.client_id = u.id 
      LEFT JOIN users m ON p.assigned_messenger_id = m.id
      WHERE p.tracking_code = $1`,
      [tracking_code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Envío no encontrado",
        message: "Verifica el código de seguimiento",
      });
    }

    const packageData = result.rows[0];
    const locations = {
      registered: "Almacén central - Apartadó",
      in_transit: "En ruta hacia destino",
      out_for_delivery: "En reparto local",
      delivered: "Ubicación del destinatario",
      cancelled: "Envío cancelado",
    };

    res.json({
      ...packageData,
      current_location:
        locations[packageData.status] || "Ubicación no disponible",
      estimated_delivery: calculateEstimatedDelivery(packageData.created_at),
    });
  } catch (error) {
    console.error("Error consultando envío:", error);
    res.status(500).json({
      error: "Error interno del servidor",
      details: error.message,
    });
  }
});

// HU6: Actualizar estado del envío
router.put("/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (!status) {
      return res.status(400).json({ error: "El campo status es obligatorio" });
    }

    const packageResult = await pool.query(
      "SELECT * FROM packages WHERE id = $1",
      [id]
    );

    if (packageResult.rows.length === 0) {
      return res.status(404).json({ error: "Envío no encontrado" });
    }

    const packageData = packageResult.rows[0];

    if (
      userRole === "messenger" &&
      packageData.assigned_messenger_id !== userId
    ) {
      return res
        .status(403)
        .json({ error: "No tienes permisos para modificar este envío" });
    }

    if (
      !["operator", "admin"].includes(userRole) &&
      ["registered", "cancelled"].includes(status)
    ) {
      return res
        .status(403)
        .json({ error: "No tienes permisos para este estado" });
    }

    const validStatuses = [
      "registered",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Estado no válido",
        valid_statuses: validStatuses,
      });
    }

    const result = await pool.query(
      `UPDATE packages 
       SET status = $1 
       WHERE id = $2 
       RETURNING id, tracking_code, status`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Envío no encontrado" });
    }

    res.json({
      message: "Estado actualizado exitosamente",
      package: result.rows[0],
    });
  } catch (error) {
    console.error("Error actualizando estado:", error);
    res.status(500).json({ error: error.message });
  }
});

// HU7: Asignar mensajero
router.put("/:id/assign-messenger", async (req, res) => {
  try {
    const { id } = req.params;
    const { messenger_id } = req.body;

    if (!messenger_id) {
      return res
        .status(400)
        .json({ error: "El ID del mensajero es obligatorio" });
    }

    const messengerCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND role = $2",
      [messenger_id, "messenger"]
    );

    if (messengerCheck.rows.length === 0) {
      return res.status(400).json({
        error: "El usuario no existe o no tiene rol de mensajero",
      });
    }

    const result = await pool.query(
      `UPDATE packages 
       SET assigned_messenger_id = $1 
       WHERE id = $2 
       RETURNING id, tracking_code, assigned_messenger_id`,
      [messenger_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Envío no encontrado" });
    }

    res.json({
      message: "Mensajero asignado exitosamente",
      package: result.rows[0],
    });
  } catch (error) {
    console.error("Error asignando mensajero:", error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener entregas del mensajero actual
router.get("/messenger/my-deliveries", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      `
      SELECT 
          p.*, 
          u.first_name || ' ' || u.last_name as client_name
      FROM packages p 
      LEFT JOIN users u ON p.client_id = u.id 
      WHERE p.assigned_messenger_id = $1 
      ORDER BY p.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error obteniendo entregas del mensajero:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Obtener envíos del cliente actual
router.get("/client/my-packages", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      `SELECT * FROM packages 
       WHERE client_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error obteniendo envíos del cliente:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// HU8: Generar código QR para envío
router.get("/:id/qr", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT tracking_code, sender_name, recipient_name, delivery_address, status
       FROM packages WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Envío no encontrado" });
    }

    const packageData = result.rows[0];

    const qrData = {
      tracking_code: packageData.tracking_code,
      sender: packageData.sender_name,
      recipient: packageData.recipient_name,
      status: packageData.status,
      tracking_url: `http://localhost:3000/tracking/${packageData.tracking_code}`,
    };

    const qr_png = qr.image(JSON.stringify(qrData), { type: "png" });

    res.setHeader("Content-Type", "image/png");
    qr_png.pipe(res);
  } catch (error) {
    console.error("Error generando QR:", error);
    res.status(500).json({ error: "Error generando código QR" });
  }
});

function calculateEstimatedDelivery(createdAt) {
  const deliveryDate = new Date(createdAt);
  deliveryDate.setDate(deliveryDate.getDate() + 3);
  return deliveryDate.toISOString().split("T")[0];
}

export default router;
