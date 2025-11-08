const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verificar conexión SMTP
transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Error configurando SMTP:', error);
  } else {
    console.log('✅ Servidor SMTP configurado correctamente');
  }
});

const sendVerificationEmail = async (email, verificationToken, userName) => {
  // ✅ CORREGIDO: Apunta al BACKEND con route parameter
  const verificationLink = `http://localhost:3001/api/verify-email/${verificationToken}`;
  
  const mailOptions = {
    from: `"Logística Segura de Urabá" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Verifica tu cuenta - Logística Segura de Urabá',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Bienvenido a Logística Segura de Urabá</h2>
        <p>Hola <strong>${userName}</strong>,</p>
        <p>Gracias por registrarte. Para activar tu cuenta, por favor verifica tu dirección de correo electrónico haciendo clic en el siguiente enlace:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" 
             style="background-color: #2563eb; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 5px; display: inline-block;">
            Verificar Mi Cuenta
          </a>
        </div>
        
        <p><strong>⚠️ Importante:</strong> Este enlace expirará en <strong>24 horas</strong>.</p>
        
        <p>Si no puedes hacer clic en el botón, copia y pega esta URL en tu navegador:</p>
        <p style="background-color: #f3f4f6; padding: 10px; border-radius: 5px; 
                  word-break: break-all; font-size: 12px;">
          ${verificationLink}
        </p>
        
        <p>Si no realizaste esta solicitud, por favor ignora este correo.</p>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">
          Logística Segura de Urabá - Entregamos confianza
        </p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Correo de verificación enviado a: ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Error enviando correo:', error);
    return false;
  }
};

const resendVerificationEmail = async (email, verificationToken, userName) => {
  return await sendVerificationEmail(email, verificationToken, userName);
};

module.exports = {
  sendVerificationEmail,
  resendVerificationEmail
};