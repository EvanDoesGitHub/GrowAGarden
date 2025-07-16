// webserver.js
const express = require('express');
const app = express();
const port = process.env.PORT || 3000; // Use process.env.PORT for Render

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(port, () => {
  console.log(`Web server running on port ${port}`);
});
