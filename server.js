const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store users and messages
const users = new Map(); // socketId -> { name, socketId, online }
const nameToSocket = new Map(); // name -> socketId
// Messages stored as pairs: "user1:user2" -> [{from, to, text, timestamp}]
const messages = new Map();

function getMessageKey(a, b) {
  return [a, b].sort().join(':');
}

function broadcastUserList() {
  const userList = [];
  users.forEach((user) => {
    userList.push({ name: user.name, socketId: user.socketId, online: true });
  });
  io.emit('user-list', userList);
}

io.on('connection', (socket) => {
  console.log(`✅ Bağlandı: ${socket.id}`);

  // User registers with a name
  socket.on('register', ({ userName }) => {
    userName = userName.trim();
    if (!userName) {
      socket.emit('error-msg', 'İsim gerekli!');
      return;
    }

    // Check if name is already taken by another online user
    if (nameToSocket.has(userName)) {
      const existingSocketId = nameToSocket.get(userName);
      if (existingSocketId !== socket.id && users.has(existingSocketId)) {
        socket.emit('error-msg', 'Bu isim zaten kullanılıyor! Başka bir isim dene.');
        return;
      }
    }

    // Register user
    users.set(socket.id, { name: userName, socketId: socket.id });
    nameToSocket.set(userName, socket.id);

    console.log(`👤 ${userName} kayıt oldu`);

    socket.emit('registered', { name: userName, socketId: socket.id });

    // Broadcast updated user list to everyone
    broadcastUserList();

    // Notify others
    socket.broadcast.emit('user-joined-notification', { name: userName });
  });

  // Get message history with a specific user
  socket.on('get-messages', ({ withUser }) => {
    const me = users.get(socket.id);
    if (!me) return;

    const key = getMessageKey(me.name, withUser);
    const history = messages.get(key) || [];
    socket.emit('message-history', { withUser, messages: history });
  });

  // Send direct message
  socket.on('send-message', ({ to, text }) => {
    const me = users.get(socket.id);
    if (!me || !text.trim()) return;

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      from: me.name,
      to: to,
      text: text.trim(),
      timestamp: Date.now(),
      status: 'sent' // sent, read
    };

    // Store message
    const key = getMessageKey(me.name, to);
    if (!messages.has(key)) messages.set(key, []);
    const msgList = messages.get(key);
    msgList.push(message);
    if (msgList.length > 300) msgList.splice(0, msgList.length - 300);

    // Send to recipient if online
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId && users.has(recipientSocketId)) {
      io.to(recipientSocketId).emit('new-message', message);
    }

    // Send back to sender (confirmation)
    socket.emit('new-message', message);
  });

  // Mark messages as read
  socket.on('mark-read', ({ fromUser }) => {
    const me = users.get(socket.id);
    if (!me) return;

    const key = getMessageKey(me.name, fromUser);
    const msgList = messages.get(key) || [];
    let updated = false;

    // Mark all unread messages from 'fromUser' to 'me' as read
    msgList.forEach(msg => {
      if (msg.from === fromUser && msg.status !== 'read') {
        msg.status = 'read';
        updated = true;
      }
    });

    if (updated) {
      // Notify the sender that their messages were read
      const senderSocketId = nameToSocket.get(fromUser);
      if (senderSocketId && users.has(senderSocketId)) {
        io.to(senderSocketId).emit('messages-read', { by: me.name });
      }
    }
  });

  // Typing indicator
  socket.on('typing', ({ to }) => {
    const me = users.get(socket.id);
    if (!me) return;
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user-typing', { name: me.name });
    }
  });

  socket.on('stop-typing', ({ to }) => {
    const me = users.get(socket.id);
    if (!me) return;
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user-stop-typing', { name: me.name });
    }
  });

  // ---- Call events ----
  socket.on('call-user', ({ to, offer, callerName, callType }) => {
    console.log(`📞 ${callerName} → ${to} arıyor (${callType})...`);
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('incoming-call', {
        from: socket.id,
        callerName,
        offer,
        callType
      });
    } else {
      socket.emit('error-msg', `${to} çevrimdışı!`);
    }
  });

  socket.on('answer-call', ({ to, answer }) => {
    io.to(to).emit('call-answered', { from: socket.id, answer });
  });

  socket.on('reject-call', ({ to }) => {
    io.to(to).emit('call-rejected', { from: socket.id });
  });

  socket.on('end-call', ({ to }) => {
    io.to(to).emit('call-ended', { from: socket.id });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`👋 ${user.name} ayrıldı`);
      nameToSocket.delete(user.name);
      users.delete(socket.id);

      // Notify others
      socket.broadcast.emit('user-left-notification', { name: user.name });
      broadcastUserList();
    }
    console.log(`❌ Bağlantı kesildi: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 8hub sunucusu çalışıyor!`);
  console.log(`📡 http://localhost:${PORT}\n`);
});
