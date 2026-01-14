const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for dev, lock down in prod if needed
    methods: ["GET", "POST"]
  }
});

// Serve static files from the React app (client/dist) in production
const clientBuildPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuildPath));

// User Queue for matching
let waitingQueue = [];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('find_partner', () => {
    if (waitingQueue.length > 0) {
      // Match found
      const partnerSocket = waitingQueue.shift();
      
      // Check if partner is still connected
      if (waitingQueue.includes(partnerSocket) || io.sockets.sockets.get(partnerSocket.id)) {
          const roomId = `${socket.id}#${partnerSocket.id}`;
          
          socket.join(roomId);
          partnerSocket.join(roomId);
          
          // Notify both users
          io.to(roomId).emit('match_found', { roomId });
          
          socket.emit('role', 'initiator'); // One peer initiates the offer
          partnerSocket.emit('role', 'receiver');
          
          console.log(`Matched ${socket.id} with ${partnerSocket.id} in room ${roomId}`);
      } else {
           // Partner disconnected in mean time, add self to queue
           waitingQueue.push(socket);
      }
    } else {
      // No one waiting, add to queue
      waitingQueue.push(socket);
      console.log(`User ${socket.id} added to queue`);
    }
  });

  // Handle WebRTC Signaling
  socket.on('signal', (data) => {
    // data: { target: roomId, type: 'offer'|'answer'|'ice', payload: ... }
    // We broadcast to the room, excluding sender
    const { room, type, payload } = data;
    socket.to(room).emit('signal', { type, payload, sender: socket.id });
  });

  // Handle Disconnect / Next
  socket.on('leave_room', (roomId) => {
      socket.to(roomId).emit('partner_left');
      socket.leave(roomId);
      // Logic: User might want to search again immediately
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove from queue if present
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    // If in a room, notify partner? (Handled by connection loss usually, but good to be explicit if we track rooms)
  });
});

// Catch-all handler for any request that doesn't match above
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Grenmegle Server running on port ${PORT}`);
});
