const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'jarwizz-backend' });
});

app.listen(PORT, () => {
  console.log(`Jarwizz backend running on port ${PORT}`);
});
