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
const users = new Map(); // socketId -> { name, socketId }
const nameToSocket = new Map(); // name -> socketId
// Messages stored as pairs: "user1:user2" -> [{from, to, text, image, audio, isViewOnce, id, status, timestamp}]
const messages = new Map();

function getMessageKey(a, b) {
  return [a, b].sort().join(':');
}

// Emits the online status of friends to a specific socket
function sendFriendsOnlineStatus(socket) {
  const onlineNames = Array.from(nameToSocket.keys());
  socket.emit('online-users-list', onlineNames);
}

// Broadcasts to all users to refresh their online friends list
function broadcastOnlineStatus() {
  const onlineNames = Array.from(nameToSocket.keys());
  io.emit('online-users-list', onlineNames);
}

io.on('connection', (socket) => {
  console.log(`✅ Bağlandı: ${socket.id}`);

  // User registers with a name
  socket.on('register', ({ userName }) => {
    userName = userName.trim();
    if (!userName) return;

    if (nameToSocket.has(userName)) {
      const existingSocketId = nameToSocket.get(userName);
      if (existingSocketId !== socket.id && users.has(existingSocketId)) {
        socket.emit('error-msg', 'Bu isim zaten çevrimiçi. Başka bir sekmede açık olabilir.');
        return;
      }
    }

    users.set(socket.id, { name: userName, socketId: socket.id });
    nameToSocket.set(userName, socket.id);

    console.log(`👤 ${userName} kayıt oldu`);
    socket.emit('registered', { name: userName, socketId: socket.id });
    
    // Send them the list of currently online people (they will filter it locally based on friends)
    broadcastOnlineStatus();
  });

  // ---- Friend Requests ----
  socket.on('send-friend-request', ({ to }) => {
    const me = users.get(socket.id);
    if (!me || !to) return;
    
    // Can't add self
    if (to === me.name) {
      socket.emit('error-msg', 'Kendini ekleyemezsin!');
      return;
    }

    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId && users.has(recipientSocketId)) {
      io.to(recipientSocketId).emit('friend-request-received', { from: me.name });
      socket.emit('friend-request-sent', { to });
    } else {
      socket.emit('error-msg', `${to} adlı kullanıcı bulunamadı veya çevrimdışı!`);
    }
  });

  socket.on('accept-friend-request', ({ from }) => {
    const me = users.get(socket.id);
    if (!me) return;
    
    const senderSocketId = nameToSocket.get(from);
    if (senderSocketId && users.has(senderSocketId)) {
      io.to(senderSocketId).emit('friend-request-accepted', { by: me.name });
    }
  });

  // ---- Messaging ----
  socket.on('get-messages', ({ withUser }) => {
    const me = users.get(socket.id);
    if (!me) return;

    const key = getMessageKey(me.name, withUser);
    const history = messages.get(key) || [];
    
    // Filter out viewed ViewOnce messages just in case
    const filteredHistory = history.filter(m => !(m.isViewOnce && m.status === 'read'));
    
    socket.emit('message-history', { withUser, messages: filteredHistory });
  });

  socket.on('send-message', ({ to, text, image, audio, isViewOnce }) => {
    const me = users.get(socket.id);
    if (!me || (!text && !image && !audio)) return;

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      from: me.name,
      to: to,
      text: text ? text.trim() : '',
      image: image || null,
      audio: audio || null,
      isViewOnce: !!isViewOnce,
      timestamp: Date.now(),
      status: 'sent'
    };

    // Store message
    const key = getMessageKey(me.name, to);
    if (!messages.has(key)) messages.set(key, []);
    const msgList = messages.get(key);
    msgList.push(message);
    if (msgList.length > 300) msgList.splice(0, msgList.length - 300);

    // Send to recipient
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId && users.has(recipientSocketId)) {
      io.to(recipientSocketId).emit('new-message', message);
    }

    // Send back confirmation
    socket.emit('new-message', message);
  });

  socket.on('mark-read', ({ fromUser }) => {
    const me = users.get(socket.id);
    if (!me) return;

    const key = getMessageKey(me.name, fromUser);
    const msgList = messages.get(key) || [];
    let updated = false;

    // Mark unread as read, AND delete viewOnce messages
    for (let i = msgList.length - 1; i >= 0; i--) {
      const msg = msgList[i];
      if (msg.from === fromUser && msg.status !== 'read') {
        msg.status = 'read';
        updated = true;
      }
      // If it was a viewOnce and it is read, we can remove it from server history
      // Note: we might want the client to explicitly delete it after viewing, but 
      // setting it to read is a good flag.
    }

    if (updated) {
      const senderSocketId = nameToSocket.get(fromUser);
      if (senderSocketId) {
        io.to(senderSocketId).emit('messages-read', { by: me.name });
      }
    }
  });

  socket.on('delete-message', ({ messageId, withUser }) => {
    const me = users.get(socket.id);
    if (!me) return;

    const key = getMessageKey(me.name, withUser);
    if (messages.has(key)) {
      const msgList = messages.get(key);
      const index = msgList.findIndex(m => m.id === messageId);
      if (index !== -1) {
        // Can only delete if I am the sender, OR if it's a View Once message I just viewed
        const msg = msgList[index];
        if (msg.from === me.name || msg.isViewOnce) {
          msgList.splice(index, 1);
          
          // Notify both parties
          socket.emit('message-deleted', { messageId });
          const partnerSocketId = nameToSocket.get(withUser);
          if (partnerSocketId) {
            io.to(partnerSocketId).emit('message-deleted', { messageId });
          }
        }
      }
    }
  });

  // ---- Typing ----
  socket.on('typing', ({ to }) => {
    const me = users.get(socket.id);
    if (!me) return;
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId) io.to(recipientSocketId).emit('user-typing', { name: me.name });
  });

  socket.on('stop-typing', ({ to }) => {
    const me = users.get(socket.id);
    if (!me) return;
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId) io.to(recipientSocketId).emit('user-stop-typing', { name: me.name });
  });

  // ---- Calls ----
  socket.on('call-user', ({ to, offer, callerName, callType }) => {
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('incoming-call', { from: socket.id, callerName, offer, callType });
    } else {
      socket.emit('error-msg', `${to} çevrimdışı!`);
    }
  });

  socket.on('answer-call', ({ to, answer }) => { io.to(to).emit('call-answered', { from: socket.id, answer }); });
  socket.on('reject-call', ({ to }) => { io.to(to).emit('call-rejected', { from: socket.id }); });
  socket.on('end-call', ({ to }) => { io.to(to).emit('call-ended', { from: socket.id }); });
  
  socket.on('camera-status', ({ to, isCameraOff }) => {
    const recipientSocketId = nameToSocket.get(to);
    if (recipientSocketId) io.to(recipientSocketId).emit('camera-status', { from: socket.id, isCameraOff });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      nameToSocket.delete(user.name);
      users.delete(socket.id);
      broadcastOnlineStatus();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 8hub sunucusu çalışıyor!`);
  console.log(`📡 http://localhost:${PORT}\n`);
});
