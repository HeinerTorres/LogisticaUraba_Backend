const express = require('express');
const router = express.Router();

// Ruta simple de prueba
router.get('/test', (req, res) => {
  res.json({ message: 'Packages route working!' });
});

// Ruta PUT con handler
router.put('/:id/status', (req, res) => {
  res.json({ 
    message: 'Status update endpoint',
    id: req.params.id
  });
});

module.exports = router;