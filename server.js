const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // We will lock this down to your Vercel URL later
    methods: ["GET", "POST"]
  }
});

// A simple map to hold the board state (100 spaces for a 10x10 board)
let boardState = Array(100).fill(null);

io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  // Send the current board to the new player
  socket.emit('boardUpdate', boardState);

  // Listen for a player clicking a space
  socket.on('playMove', (data) => {
    const { index, color } = data;
    
    // Update the server's board state if the space is empty
    if (!boardState[index]) {
      boardState[index] = color;
      
      // Tell ALL connected players to update their screens
      io.emit('boardUpdate', boardState);
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
