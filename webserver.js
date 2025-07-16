// webserver.js
const express = require('express');
const app = express();
const port = 3000; // Replit usually uses port 3000

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(port, () => {
  console.log(`Web server running on port ${port}`);
});
