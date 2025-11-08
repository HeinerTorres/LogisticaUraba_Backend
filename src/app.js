const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// ================================================
// 🔐 TOKEN TEMPORAL (2FA) - MODIFICADO
// ================================================
const tokens = {};
const verifiedSessions = {}; // Para manejar sesiones temporales

app.post('/api/send-token', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Falta el correo electrónico' });
  }

  const token = crypto.randomInt(100000, 999999).toString();
  tokens[email] = {
    token,
    expires: Date.now() + 2 * 60 * 1000 // 2 minutos
  };

  console.log(`🔐 Token generado para ${email}: ${token}`);
  
  res.json({
    success: true,
    message: '✅ Token generado correctamente',
    token: token,
    expiresIn: '2 minutos'
  });
});

app.post('/api/verify-token', async (req, res) => {
  try {
    const { email, token } = req.body;
    
    if (!email || !token) {
      return res.status(400).json({ error: 'Email y token son requeridos' });
    }

    const record = tokens[email];
    
    if (!record) {
      return res.status(400).json({ error: 'No se encontró token para este correo. Genera uno nuevo.' });
    }
    
    if (record.expires < Date.now()) {
      delete tokens[email];
      return res.status(400).json({ error: 'Token caducado. Genera uno nuevo.' });
    }
    
    if (record.token !== token) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    // NO marcar como verificado en la BD, solo crear sesión temporal
    const sessionId = crypto.randomBytes(16).toString('hex');
    verifiedSessions[sessionId] = {
      email: email,
      expires: Date.now() + 24 * 60 * 60 * 1000 // 24 horas
    };

    delete tokens[email];
    
    res.json({ 
      success: true,
      message: '✅ Código verificado correctamente. Ahora puedes iniciar sesión.',
      session_id: sessionId // Enviamos el ID de sesión temporal
    });

  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================
// 🔑 RUTA DE LOGIN CORREGIDA - CON VERIFICACIÓN DE SESIÓN TEMPORAL
// ================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, session_id } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const pool = require('./database');
    
    const userResult = await pool.query(
      `SELECT 
        id, 
        first_name, 
        second_name, 
        last_name, 
        second_last_name, 
        document_number,
        email, 
        address,
        phone,
        role, 
        is_email_verified, 
        password_hash 
       FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = userResult.rows[0];

    // Verificar contraseña
    const bcrypt = require('bcrypt');
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Nueva lógica de verificación
    const isPermanentlyVerified = user.is_email_verified;
    const hasValidSession = session_id && verifiedSessions[session_id] && 
                           verifiedSessions[session_id].email === email &&
                           verifiedSessions[session_id].expires > Date.now();

    // Si no está verificado permanentemente Y no tiene sesión válida
    if (!isPermanentlyVerified && !hasValidSession) {
      return res.status(403).json({ 
        error: 'Email no verificado',
        requires_token: true,
        message: 'Por favor verifica tu email o usa un token temporal para acceder'
      });
    }

    // Si tiene sesión válida pero no está verificado permanentemente, usar sesión
    if (!isPermanentlyVerified && hasValidSession) {
      console.log(`🔐 Usuario ${email} accediendo con sesión temporal`);
    }

    // Generar JWT token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role,
        is_temporary: !isPermanentlyVerified
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Devolver usuario y token (sin password_hash)
    const { password_hash, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Login exitoso',
      token: token,
      user: userWithoutPassword,
      is_temporary: !isPermanentlyVerified
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================
// 🚪 RUTA PARA CERRAR SESIÓN - LIMPIAR SESIÓN TEMPORAL
// ================================================
app.post('/api/auth/logout', (req, res) => {
  try {
    const { email } = req.body;
    
    // Buscar y eliminar cualquier sesión por email
    if (email) {
      Object.keys(verifiedSessions).forEach(key => {
        if (verifiedSessions[key].email === email) {
          delete verifiedSessions[key];
          console.log(`🔐 Sesión temporal eliminada para: ${email}`);
        }
      });
    }

    res.json({
      success: true,
      message: 'Sesión cerrada correctamente'
    });

  } catch (error) {
    console.error('Error en logout:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================
// 📧 VERIFICACIÓN DE EMAIL (PERMANENTE)
// ================================================

app.get('/api/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.redirect('http://localhost:3000/login?verified=false&error=no_token');
    }

    const pool = require('./database');
    
    const userResult = await pool.query(
      'SELECT id, email, first_name, second_name, last_name, second_last_name, role FROM users WHERE verification_token = $1',
      [token]
    );

    if (userResult.rows.length === 0) {
      console.log('❌ Token no encontrado:', token);
      return res.redirect('http://localhost:3000/login?verified=false&error=invalid_token');
    }

    const user = userResult.rows[0];

    // VERIFICACIÓN PERMANENTE: Marcar como verificado en BD
    const updateResult = await pool.query(
      'UPDATE users SET is_email_verified = true, verification_token = NULL WHERE id = $1 RETURNING id, email, first_name, second_name, last_name, second_last_name, role',
      [user.id]
    );

    if (updateResult.rows.length === 0) {
      return res.redirect('http://localhost:3000/login?verified=false&error=user_not_found');
    }

    const verifiedUser = updateResult.rows[0];

    // Generar token de acceso
    const jwt = require('jsonwebtoken');
    const accessToken = jwt.sign(
      { 
        userId: verifiedUser.id,
        email: verifiedUser.email,
        role: verifiedUser.role,
        is_temporary: false
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const redirectUrl = `http://localhost:3000/verified-success?token=${accessToken}&user=${encodeURIComponent(verifiedUser.first_name)}&email=${encodeURIComponent(verifiedUser.email)}`;
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('❌ Error verificando email:', error);
    res.redirect('http://localhost:3000/login?verified=false&error=server_error');
  }
});

// ================================================
// 👤 RUTA PARA OBTENER INFO DEL USUARIO ACTUAL
// ================================================
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const pool = require('./database');
    const result = await pool.query(
      `SELECT 
        id, 
        first_name, 
        second_name, 
        last_name, 
        second_last_name, 
        document_number,
        email, 
        address,
        phone,
        role, 
        is_email_verified 
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================
// 📧 REENVIAR CORREO DE VERIFICACIÓN
// ================================================
app.post('/api/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email es requerido' });
    }

    const pool = require('./database');
    const userResult = await pool.query(
      'SELECT id, first_name, last_name, is_email_verified FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const user = userResult.rows[0];
    if (user.is_email_verified) {
      return res.status(400).json({ error: 'El email ya está verificado' });
    }

    // Generar nuevo token
    const newVerificationToken = crypto.randomBytes(32).toString('hex');
    
    // Actualizar token en base de datos
    await pool.query(
      'UPDATE users SET verification_token = $1 WHERE id = $2',
      [newVerificationToken, user.id]
    );

    // Reenviar correo
    const emailService = require('./services/emailService');
    const emailSent = await emailService.resendVerificationEmail(
      email,
      newVerificationToken,
      `${user.first_name} ${user.last_name}`
    );

    if (emailSent) {
      res.json({ 
        success: true,
        message: '✅ Correo de verificación reenviado exitosamente' 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: '❌ Error reenviando correo de verificación' 
      });
    }

  } catch (error) {
    console.error('❌ Error reenviando verificación:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error interno del servidor' 
    });
  }
});

// ================================================
// 📦 IMPORTAR Y USAR RUTAS EXISTENTES
// ================================================
const userRoutes = require('./routes/users');
const packageRoutes = require('./routes/packages');
const authRoutes = require('./routes/auth');

app.use('/api/users', userRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/auth', authRoutes);

// ================================================
// 🧪 RUTAS DE PRUEBA
// ================================================
app.get('/', (req, res) => {
  res.json({
    message: '¡Backend de Logística Urabá funcionando!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    features: [
      'Verificación por email ✅',
      'Login automático después de verificación ✅',
      'Token temporal OPCIONAL ✅',
      'Sistema de paquetes 📦',
      'Gestión de usuarios 👥'
    ],
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      packages: '/api/packages',
      verifyEmail: '/api/verify-email/:token',
      resendVerification: '/api/resend-verification',
      sendToken: '/api/send-token',
      verifyToken: '/api/verify-token',
      getUser: '/api/auth/me'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    database: 'PostgreSQL',
    project: 'Logística Segura Urabá',
    emailService: 'SMTP Configurado',
    verificationSystem: 'Activo ✅',
    tokenSystem: 'Sesiones temporales ✅'
  });
});

// ================================================
// 🔄 LIMPIAR SESIONES EXPIRADAS
// ================================================
function cleanupExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;
  Object.keys(verifiedSessions).forEach(key => {
    if (verifiedSessions[key].expires < now) {
      delete verifiedSessions[key];
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log(`🧹 Limpiadas ${cleaned} sesiones expiradas`);
  }
}

// Ejecutar limpieza cada hora
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    available_endpoints: [
      'GET /',
      'GET /api/health',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'POST /api/auth/register',
      'POST /api/users/register',
      'POST /api/send-token',
      'POST /api/verify-token',
      'GET /api/verify-email/:token',
      'POST /api/resend-verification',
      'GET /api/auth/me'
    ]
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📧 Sistema de verificación por email ACTIVO`);
  console.log(`🔐 Login corregido - usando password_hash ✅`);
  console.log(`🔑 Token temporal con sesiones: ACTIVADO ✅`);
  console.log(`🔄 Limpieza de sesiones: ACTIVADA ✅`);
});