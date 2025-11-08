const jwt = require('jsonwebtoken');

// Middleware para autenticar tokens JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Token de acceso requerido',
      message: 'Debes iniciar sesión para acceder a este recurso'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        error: 'Token inválido o expirado',
        message: 'Por favor inicia sesión nuevamente'
      });
    }

    req.user = user;
    next();
  });
};

// Generar token de verificación (expira en 24 horas)
const generateVerificationToken = (userId, email) => {
  return jwt.sign(
    { 
      userId: userId,
      email: email,
      type: 'email_verification'
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Verificar token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = {
  authenticateToken,
  generateVerificationToken,
  verifyToken
};