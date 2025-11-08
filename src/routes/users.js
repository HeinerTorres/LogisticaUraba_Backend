const express = require('express');
const router = express.Router();
const pool = require('../database');
const bcrypt = require('bcrypt');
const { generateVerificationToken } = require('../middleware/auth');
const { sendVerificationEmail } = require('../services/emailService');

// Ruta de registro con verificación de email
router.post('/register', async (req, res) => {
  try {
    const {
      first_name,
      second_name,
      last_name,
      second_last_name,
      document_number,
      email,
      address,
      phone,
      role,
      password
    } = req.body;

    // Validaciones básicas
    if (!first_name || !last_name || !document_number || !email || !password) {
      return res.status(400).json({
        error: 'Faltan campos obligatorios: nombre, apellido, documento, email, contraseña'
      });
    }

    // Verificar si el usuario ya existe
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR document_number = $2',
      [email, document_number]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({
        error: 'El usuario ya existe (email o documento ya registrado)'
      });
    }

    // Hash de la contraseña
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insertar usuario en la base de datos
    const result = await pool.query(
      `INSERT INTO users 
       (first_name, second_name, last_name, second_last_name, document_number, 
        email, address, phone, role, password_hash, is_email_verified) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
       RETURNING id, first_name, last_name, email, role, is_email_verified`,
      [first_name, second_name, last_name, second_last_name, document_number, 
       email, address, phone, role, password_hash, false]
    );

    const newUser = result.rows[0];

    // ✅ GENERAR Y ENVIAR CORREO DE VERIFICACIÓN
    const verificationToken = generateVerificationToken(newUser.id, email);
    
    // Guardar token en la base de datos
    await pool.query(
      'UPDATE users SET verification_token = $1 WHERE id = $2',
      [verificationToken, newUser.id]
    );

    // Enviar correo de verificación
    const emailSent = await sendVerificationEmail(
      email, 
      verificationToken, 
      `${first_name} ${last_name}`
    );

    res.status(201).json({
      message: '✅ Usuario registrado exitosamente. Por favor verifica tu email para activar tu cuenta.',
      user: {
        id: newUser.id,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        email: newUser.email,
        role: newUser.role
      },
      emailSent: emailSent,
      nextStep: 'Revisa tu correo electrónico y haz clic en el enlace de verificación'
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      error: 'Error interno del servidor: ' + error.message
    });
  }
});

// Obtener todos los usuarios
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, first_name, last_name, email, role, is_email_verified, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener usuarios por rol
router.get('/role/:role', async (req, res) => {
  try {
    const { role } = req.params;
    const result = await pool.query(
      'SELECT id, first_name, last_name, email, phone FROM users WHERE role = $1 AND is_email_verified = true',
      [role]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;