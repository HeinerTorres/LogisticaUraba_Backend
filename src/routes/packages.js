const express = require('express');
const router = express.Router(); // ✅ USA express.Router() NO el paquete 'router'
const pool = require('../database');
const { authenticateToken } = require('../middleware/auth');
const qr = require('qr-image');

// HU4: Registrar nuevo envío
router.post('/register', async (req, res) => {
    try {
        const {
            sender_name,
            recipient_name,
            delivery_address,
            weight,
            client_id
        } = req.body;

        // Validación básica
        if (!sender_name || !recipient_name || !delivery_address || !client_id) {
            return res.status(400).json({
                error: 'Faltan campos obligatorios: remitente, destinatario, dirección, cliente'
            });
        }

        // Generar código de seguimiento único (simple)
        const tracking_code = `URABA-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        
        // Calcular costo basado en el peso
        const baseCost = 10000; // $10,000 base
        const costPerKg = 5000; // $5,000 por kg
        const cost = weight ? baseCost + (parseFloat(weight) * costPerKg) : baseCost;

        console.log('Registrando envío:', { tracking_code, sender_name, recipient_name, cost });

        // Insertar en la base de datos
        const result = await pool.query(
            `INSERT INTO packages 
             (tracking_code, sender_name, recipient_name, delivery_address, weight, cost, client_id, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             RETURNING id, tracking_code, sender_name, recipient_name, delivery_address, cost, status, created_at`,
            [tracking_code, sender_name, recipient_name, delivery_address, weight, cost, client_id, 'registered']
        );

        res.status(201).json({
            message: 'Envío registrado exitosamente',
            package: result.rows[0]
        });

    } catch (error) {
        console.error('Error registrando envío:', error);
        res.status(500).json({
            error: 'Error interno del servidor: ' + error.message
        });
    }
});

// Obtener todos los envíos
router.get('/', async (req, res) => {
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
router.get('/tracking/:tracking_code', async (req, res) => {
    try {
        const { tracking_code } = req.params;
        
        const result = await pool.query(`
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
                error: 'Envío no encontrado',
                message: 'Verifica el código de seguimiento'
            });
        }
        
        // Simular ubicación GPS (en producción vendría de los mensajeros)
        const package = result.rows[0];
        const locations = {
            'registered': 'Almacén central - Apartadó',
            'in_transit': 'En ruta hacia destino',
            'out_for_delivery': 'En reparto local',
            'delivered': 'Ubicación del destinatario',
            'cancelled': 'Envío cancelado'
        };
        
        res.json({
            ...package,
            current_location: locations[package.status] || 'Ubicación no disponible',
            estimated_delivery: calculateEstimatedDelivery(package.created_at)
        });

    } catch (error) {
        console.error('Error consultando envío:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message 
        });
    }
});

// HU6: Actualizar estado del envío (para operarios)
router.put('/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.userId;
        const userRole = req.user.role;

        if (!status) {
            return res.status(400).json({
                error: 'El campo status es obligatorio'
            });
        }

        // Verificar permisos
        const packageResult = await pool.query(
            'SELECT * FROM packages WHERE id = $1',
            [id]
        );

        if (packageResult.rows.length === 0) {
            return res.status(404).json({ error: 'Envío no encontrado' });
        }

        const package = packageResult.rows[0];

        // Solo el mensajero asignado puede cambiar estados si es mensajero
        if (userRole === 'messenger' && package.assigned_messenger_id !== userId) {
            return res.status(403).json({ error: 'No tienes permisos para modificar este envío' });
        }

        // Solo operarios/admin pueden asignar cualquier estado
        if (!['operator', 'admin'].includes(userRole) && 
            ['registered', 'cancelled'].includes(status)) {
            return res.status(403).json({ error: 'No tienes permisos para este estado' });
        }

        const validStatuses = ['registered', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'Estado no válido',
                valid_statuses: validStatuses
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
            return res.status(404).json({ error: 'Envío no encontrado' });
        }

        res.json({
            message: 'Estado actualizado exitosamente',
            package: result.rows[0]
        });

    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: error.message });
    }
});

// HU6: Obtener envío por ID (para edición)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT 
                p.*, 
                u.first_name || ' ' || u.last_name as client_name,
                m.first_name || ' ' || m.last_name as messenger_name
            FROM packages p 
            LEFT JOIN users u ON p.client_id = u.id 
            LEFT JOIN users m ON p.assigned_messenger_id = m.id
            WHERE p.id = $1`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Envío no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// HU6: Actualizar información del envío
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            sender_name, 
            recipient_name, 
            delivery_address, 
            weight,
            status 
        } = req.body;

        // Validar que al menos un campo sea proporcionado
        if (!sender_name && !recipient_name && !delivery_address && !weight && !status) {
            return res.status(400).json({
                error: 'Debe proporcionar al menos un campo para actualizar'
            });
        }

        // Construir query dinámicamente
        let updateFields = [];
        let values = [];
        let paramCount = 1;

        if (sender_name) {
            updateFields.push(`sender_name = $${paramCount}`);
            values.push(sender_name);
            paramCount++;
        }
        if (recipient_name) {
            updateFields.push(`recipient_name = $${paramCount}`);
            values.push(recipient_name);
            paramCount++;
        }
        if (delivery_address) {
            updateFields.push(`delivery_address = $${paramCount}`);
            values.push(delivery_address);
            paramCount++;
        }
        if (weight) {
            updateFields.push(`weight = $${paramCount}`);
            values.push(weight);
            paramCount++;
        }
        if (status) {
            const validStatuses = ['registered', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    error: 'Estado no válido',
                    valid_statuses: validStatuses
                });
            }
            updateFields.push(`status = $${paramCount}`);
            values.push(status);
            paramCount++;
        }

        values.push(id);

        const query = `
            UPDATE packages 
            SET ${updateFields.join(', ')} 
            WHERE id = $${paramCount} 
            RETURNING id, tracking_code, sender_name, recipient_name, delivery_address, weight, status, cost
        `;

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Envío no encontrado' });
        }

        res.json({
            message: 'Envío actualizado exitosamente',
            package: result.rows[0]
        });

    } catch (error) {
        console.error('Error actualizando envío:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor: ' + error.message 
        });
    }
});

// HU7: Asignar mensajero a envío
router.put('/:id/assign-messenger', async (req, res) => {
    try {
        const { id } = req.params;
        const { messenger_id } = req.body;

        if (!messenger_id) {
            return res.status(400).json({
                error: 'El ID del mensajero es obligatorio'
            });
        }

        // Verificar que el mensajero existe y tiene rol correcto
        const messengerCheck = await pool.query(
            'SELECT id FROM users WHERE id = $1 AND role = $2',
            [messenger_id, 'messenger']
        );

        if (messengerCheck.rows.length === 0) {
            return res.status(400).json({
                error: 'El usuario no existe o no tiene rol de mensajero'
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
            return res.status(404).json({ error: 'Envío no encontrado' });
        }

        res.json({
            message: 'Mensajero asignado exitosamente',
            package: result.rows[0]
        });

    } catch (error) {
        console.error('Error asignando mensajero:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener entregas del mensajero actual
router.get('/messenger/my-deliveries', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      `SELECT 
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
    console.error('Error obteniendo entregas del mensajero:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener envíos del cliente actual
router.get('/client/my-packages', authenticateToken, async (req, res) => {
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
    console.error('Error obteniendo envíos del cliente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// HU8: Generar código QR para envío
router.get('/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT tracking_code, sender_name, recipient_name, delivery_address, status
       FROM packages WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }
    
    const package = result.rows[0];
    
    const qrData = {
      tracking_code: package.tracking_code,
      sender: package.sender_name,
      recipient: package.recipient_name,
      status: package.status,
      tracking_url: `http://localhost:3000/tracking/${package.tracking_code}`
    };
    
    const qr_png = qr.image(JSON.stringify(qrData), { type: 'png' });
    
    res.setHeader('Content-Type', 'image/png');
    qr_png.pipe(res);
    
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).json({ error: 'Error generando código QR' });
  }
});

// Función auxiliar para calcular fecha estimada de entrega
function calculateEstimatedDelivery(createdAt) {
    const deliveryDate = new Date(createdAt);
    deliveryDate.setDate(deliveryDate.getDate() + 3);
    return deliveryDate.toISOString().split('T')[0];
}

module.exports = router;