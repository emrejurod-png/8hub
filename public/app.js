(() => {
  const state = {
    socket: null,
    myName: '',
    friends: [], // Loaded from localStorage: [{name}]
    chats: {}, // Loaded from localStorage
    onlineUsers: [], // Loaded from server: ['name1', 'name2']
    selectedUser: null, // { name, socketId }
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    isMuted: false,
    isCameraOff: false,
    inCall: false,
    callType: 'video',
    incomingCallData: null,
    callTimerInterval: null,
    callStartTime: null,
    ringtoneOscillator: null,
    ringtoneCtx: null,
    typingTimeout: null,
    mediaRecorder: null,
    audioChunks: []
  };

  const $ = (sel) => document.querySelector(sel);
  const dom = {
    loginScreen: $('#login-screen'),
    mainScreen: $('#main-screen'),
    callScreen: $('#call-screen'),
    userNameInput: $('#user-name'),
    joinBtn: $('#join-btn'),
    myInitialSidebar: $('#my-initial-sidebar'),
    myNameSidebar: $('#my-name-sidebar'),
    logoutBtn: $('#logout-btn'),
    searchUsers: $('#search-users'),
    userList: $('#user-list'),
    appLayout: null,
    chatPanel: $('#chat-panel'),
    noChatSelected: $('#no-chat-selected'),
    activeChat: $('#active-chat'),
    backToSidebar: $('#back-to-sidebar'),
    chatPartnerInitial: $('#chat-partner-initial'),
    chatPartnerName: $('#chat-partner-name'),
    chatPartnerStatus: $('#chat-partner-status'),
    topVoiceBtn: $('#top-voice-btn'),
    topVideoBtn: $('#top-video-btn'),
    messagesContainer: $('#messages-container'),
    messageInput: $('#message-input'),
    sendMsgBtn: $('#send-msg-btn'),
    typingIndicator: $('#typing-indicator'),
    typingName: $('#typing-name'),
    remoteVideo: $('#remote-video'),
    localVideo: $('#local-video'),
    callStatusOverlay: $('#call-status-overlay'),
    callPartnerInitial: $('#call-partner-initial'),
    callPartnerNameDisplay: $('#call-partner-name-display'),
    callStatusText: $('#call-status-text'),
    callTimer: $('#call-timer'),
    toggleMuteBtn: $('#toggle-mute-btn'),
    toggleCameraBtn: $('#toggle-camera-btn'),
    endCallBtn: $('#end-call-btn'),
    incomingModal: $('#incoming-call-modal'),
    incomingCallerInitial: $('#incoming-caller-initial'),
    incomingCallerName: $('#incoming-caller-name'),
    incomingCallType: $('#incoming-call-type'),
    acceptBtn: $('#accept-btn'),
    rejectBtn: $('#reject-btn'),
    toast: $('#toast-container'),
    // New UI
    addFriendBtn: $('#add-friend-btn'),
    addFriendModal: $('#add-friend-modal'),
    friendUsernameInput: $('#friend-username-input'),
    sendFriendRequestBtn: $('#send-friend-request-btn'),
    cancelFriendBtn: $('#cancel-friend-btn'),
    imageUploadModal: $('#image-upload-modal'),
    imagePreview: $('#image-preview'),
    viewOnceCheckbox: $('#view-once-checkbox'),
    sendImageBtn: $('#send-image-btn'),
    cancelImageBtn: $('#cancel-image-btn'),
    voiceRecordBtn: $('#voice-record-btn'),
    attachBtn: $('#attach-btn'),
    imageInput: $('#image-input')
  };

  let pendingImageBase64 = null;

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  function getInitial(name) { return name ? name.charAt(0).toUpperCase() : '?'; }
  function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

  function showScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  function showToast(msg, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast visible';
    toast.textContent = msg;
    dom.toast.appendChild(toast);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, duration);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ============ RINGTONE & NOTIFS ============
  function startRingtone() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      state.ringtoneCtx = ctx;
      function playTone() {
        if (!state.ringtoneCtx || state.ringtoneCtx.state === 'closed') return;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'sine'; osc1.frequency.value = 440;
        osc2.type = 'sine'; osc2.frequency.value = 480;
        gain.gain.value = 0.15;
        osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.setValueAtTime(0, now + 0.8);
        osc1.start(now); osc2.start(now);
        osc1.stop(now + 0.8); osc2.stop(now + 0.8);
        state.ringtoneOscillator = setTimeout(playTone, 2500);
      }
      playTone();
    } catch (e) {}
  }

  function stopRingtone() {
    if (state.ringtoneOscillator) { clearTimeout(state.ringtoneOscillator); state.ringtoneOscillator = null; }
    if (state.ringtoneCtx) { state.ringtoneCtx.close().catch(() => {}); state.ringtoneCtx = null; }
  }
  function playMessageSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 800; gain.gain.value = 0.08;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
      setTimeout(() => ctx.close(), 200);
    } catch (e) {}
  }

  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: '8hub', renotify: true, vibrate: [200, 100, 200] }); } catch (e) {}
    }
  }

  // ============ DATA STORAGE ============
  function loadFriends() {
    const saved = localStorage.getItem('8hub_friends');
    if (saved) state.friends = JSON.parse(saved);
    else state.friends = [];
  }

  function saveFriends() {
    localStorage.setItem('8hub_friends', JSON.stringify(state.friends));
  }

  function loadChats() {
    const saved = localStorage.getItem('8hub_chats');
    if (saved) state.chats = JSON.parse(saved);
    else state.chats = {};
  }

  function saveChats() {
    localStorage.setItem('8hub_chats', JSON.stringify(state.chats));
  }

  function addFriend(name) {
    if (!state.friends.some(f => f.name === name)) {
      state.friends.push({ name });
      saveFriends();
      renderUserList();
    }
  }

  // ============ USER LIST ============
  function renderUserList(filter = '') {
    const filtered = filter
      ? state.friends.filter(f => f.name.toLowerCase().includes(filter.toLowerCase()))
      : state.friends;

    if (filtered.length === 0) {
      dom.userList.innerHTML = `
        <div class="empty-users">
          <span class="empty-icon">👥</span>
          <p>${filter ? 'Arkadaş bulunamadı' : 'Henüz arkadaşın yok. Üstteki + butonundan ekle!'}</p>
        </div>`;
      return;
    }

    dom.userList.innerHTML = filtered.map(friend => {
      const isOnline = state.onlineUsers.includes(friend.name);
      return `
      <div class="user-item ${state.selectedUser && state.selectedUser.name === friend.name ? 'active' : ''}"
           data-name="${escapeHtml(friend.name)}">
        <div class="user-item-avatar">
          ${getInitial(friend.name)}
          <div class="user-online-dot" style="background: ${isOnline ? 'var(--primary)' : 'var(--text-muted)'}"></div>
        </div>
        <div class="user-item-info">
          <h4>${escapeHtml(friend.name)}</h4>
          <p style="color: ${isOnline ? 'var(--primary)' : 'var(--text-muted)'}">${isOnline ? '🟢 Çevrimiçi' : 'Çevrimdışı'}</p>
        </div>
      </div>
    `}).join('');

    dom.userList.querySelectorAll('.user-item').forEach(item => {
      item.addEventListener('click', () => selectUser(item.dataset.name));
    });
  }

  function selectUser(name) {
    state.selectedUser = { name };
    dom.userList.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    const selectedEl = dom.userList.querySelector(`[data-name="${name}"]`);
    if (selectedEl) selectedEl.classList.add('active');

    dom.appLayout.classList.add('chat-open');
    dom.noChatSelected.style.display = 'none';
    dom.activeChat.style.display = 'flex';
    dom.chatPartnerInitial.textContent = getInitial(name);
    dom.chatPartnerName.textContent = name;
    
    const isOnline = state.onlineUsers.includes(name);
    dom.chatPartnerStatus.textContent = isOnline ? 'Çevrimiçi' : 'Çevrimdışı';

    dom.messagesContainer.innerHTML = '';
    const history = state.chats[name] || [];
    if (history.length === 0) {
      dom.messagesContainer.innerHTML = '<div class="empty-chat"><p>Henüz mesaj yok. İlk mesajı sen gönder!</p></div>';
    } else {
      history.forEach(msg => appendMessage(msg));
    }
  }

  // ============ MESSAGING ============
  function isEmojiOnly(str) {
    const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+$/u;
    return emojiRegex.test(str.replace(/\s/g, ''));
  }

  function appendMessage(msg) {
    if (msg.isViewOnce && msg.status === 'read' && msg.from !== state.myName) return;

    const isMine = msg.from === state.myName;
    const time = new Date(msg.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const empty = dom.messagesContainer.querySelector('.empty-chat');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.id = `msg-${msg.id}`;
    
    const isEmoji = !msg.isDeleted && !msg.image && !msg.audio && msg.text && isEmojiOnly(msg.text);
    div.className = `message-bubble ${isMine ? 'sent' : 'received'} ${isEmoji ? 'emoji-only' : ''}`;
    
    let ticks = '';
    if (isMine) ticks = `<span class="read-receipt ${msg.status === 'read' ? 'read' : ''}">✓✓</span>`;

    let contentHtml = '';
    if (msg.isDeleted) {
      contentHtml += `<div style="font-style:italic; color:var(--text-muted);">🚫 Bu mesaj silindi</div>`;
    } else if (msg.isViewOnce) {
      if (isMine) {
        contentHtml += `<div style="color:var(--danger)">💣 Tek Gösterimlik Gönderildi</div>`;
      } else {
        contentHtml += `<button class="view-once-btn" onclick="viewOnceMessage('${msg.id}', '${msg.image}')">💣 Fotoğrafı Gör</button>`;
      }
    } else if (msg.image) {
      contentHtml += `<img src="${msg.image}" class="message-image" onclick="window.open(this.src)" />`;
    }
    
    if (!msg.isDeleted && msg.audio) {
      contentHtml += `<audio controls class="audio-message"><source src="${msg.audio}" type="audio/webm"></audio>`;
    }
    if (!msg.isDeleted && msg.text) {
      contentHtml += `<div>${escapeHtml(msg.text)}</div>`;
    }

    const deleteBtn = (isMine && !msg.isDeleted) ? `<button class="btn-delete-msg" onclick="deleteMessage('${msg.id}')" title="Herkesten Sil">🗑️</button>` : '';

    div.innerHTML = `
      ${contentHtml}
      <div class="message-meta">
        <span>${time}</span>${ticks}
        <div class="message-actions">${deleteBtn}</div>
      </div>
    `;
    dom.messagesContainer.appendChild(div);
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
  }

  window.deleteMessage = function(messageId) {
    if (!state.selectedUser) return;
    state.socket.emit('delete-message', { messageId, withUser: state.selectedUser.name });
  };

  window.viewOnceMessage = function(messageId, base64Image) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed'; overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.9)'; overlay.style.zIndex = '9999';
    overlay.style.display = 'flex'; overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
    
    overlay.innerHTML = `
      <p style="color:#fff; margin-bottom:20px;">💣 Bu fotoğraf kapatıldığında sonsuza dek silinecek.</p>
      <img src="${base64Image}" style="max-width:90%; max-height:80%; border-radius:10px;">
      <button class="btn btn-primary" style="margin-top:20px;" onclick="this.parentElement.remove()">Kapat & Sil</button>
    `;
    document.body.appendChild(overlay);

    const observer = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        if (state.selectedUser) state.socket.emit('delete-message', { messageId, withUser: state.selectedUser.name });
      }
    });
    observer.observe(document.body, { childList: true });
  };

  function sendMessage(text = '', imageStr = null, audioStr = null, isViewOnce = false) {
    if (!state.selectedUser) return;
    if (!text && !imageStr && !audioStr) return;
    
    state.socket.emit('send-message', { 
      to: state.selectedUser.name, 
      text, 
      image: imageStr, 
      audio: audioStr,
      isViewOnce 
    });
    
    dom.messageInput.value = '';
    state.socket.emit('stop-typing', { to: state.selectedUser.name });
  }

  // ============ WEB RTC & CALLS ============
  async function startCall(type) {
    if (!state.selectedUser) return;
    if (!state.onlineUsers.includes(state.selectedUser.name)) {
      showToast('❌ Kullanıcı çevrimdışı, aranamaz.');
      return;
    }

    state.callType = type;
    dom.callPartnerInitial.textContent = getInitial(state.selectedUser.name);
    dom.callPartnerNameDisplay.textContent = state.selectedUser.name;
    dom.callStatusText.textContent = 'Arıyor...';
    dom.callTimer.style.display = 'none';
    dom.callStatusOverlay.classList.remove('hidden');
    dom.toggleCameraBtn.style.display = type === 'video' ? 'flex' : 'none';
    showScreen(dom.callScreen);

    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      dom.localVideo.srcObject = state.localStream;
      dom.localVideo.play().catch(e => console.log('Local video play error:', e));
      setupPeerConnection(state.selectedUser.name);
      
      const offer = await state.peerConnection.createOffer();
      await state.peerConnection.setLocalDescription(offer);
      
      state.socket.emit('call-user', { to: state.selectedUser.name, offer, callerName: state.myName, callType: type });
      state.inCall = true;
    } catch (err) {
      showToast('⚠️ Kamera veya mikrofona erişilemedi!');
      endCallCleanup();
    }
  }

  async function answerCall() {
    dom.incomingModal.classList.remove('active');
    stopRingtone();
    if (!state.incomingCallData) return;
    const { from, callerName, offer, callType } = state.incomingCallData;
    state.selectedUser = { name: callerName };

    dom.callPartnerInitial.textContent = getInitial(callerName);
    dom.callPartnerNameDisplay.textContent = callerName;
    dom.callStatusText.textContent = 'Bağlanıyor...';
    dom.callTimer.style.display = 'none';
    dom.callStatusOverlay.classList.remove('hidden');
    dom.toggleCameraBtn.style.display = callType === 'video' ? 'flex' : 'none';
    showScreen(dom.callScreen);

    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
      dom.localVideo.srcObject = state.localStream;
      dom.localVideo.play().catch(e => console.log('Local video play error:', e));
      setupPeerConnection(callerName);

      await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);

      state.socket.emit('answer-call', { to: callerName, answer });
      state.inCall = true;
      dom.callStatusText.textContent = 'Bağlandı!';
      startCallTimer();
    } catch (err) {
      showToast('⚠️ Kamera veya mikrofona erişilemedi!');
      rejectCall();
    }
  }

  function rejectCall() {
    dom.incomingModal.classList.remove('active');
    stopRingtone();
    if (state.incomingCallData) {
      state.socket.emit('reject-call', { to: state.incomingCallData.callerName });
      state.incomingCallData = null;
    }
  }

  function setupPeerConnection(targetName) {
    if (state.peerConnection) state.peerConnection.close();
    state.peerConnection = new RTCPeerConnection(iceServers);
    
    state.localStream.getTracks().forEach(t => state.peerConnection.addTrack(t, state.localStream));
    
    state.peerConnection.ontrack = (e) => {
      dom.callStatusOverlay.classList.add('hidden');
      if (!state.remoteStream) state.remoteStream = new MediaStream();
      state.remoteStream.addTrack(e.track);
      dom.remoteVideo.srcObject = state.remoteStream;
      dom.remoteVideo.play().catch(err => console.log('Remote video play error:', err));
    };

    state.peerConnection.onicecandidate = (e) => {
      if (e.candidate) state.socket.emit('ice-candidate', { to: targetName, candidate: e.candidate });
    };

    state.peerConnection.onconnectionstatechange = () => {
      const s = state.peerConnection.connectionState;
      if (s === 'connected') dom.callStatusText.textContent = 'Bağlandı!';
      else if (s === 'disconnected' || s === 'failed') { showToast('⚠️ Bağlantı kesildi'); endCallCleanup(); }
    };
  }

  function endCall() {
    if (state.selectedUser) state.socket.emit('end-call', { to: state.selectedUser.name });
    endCallCleanup();
  }

  function endCallCleanup() {
    state.inCall = false;
    if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
    if (state.peerConnection) { state.peerConnection.close(); state.peerConnection = null; }
    dom.localVideo.srcObject = null; dom.remoteVideo.srcObject = null;
    if (state.callTimerInterval) { clearInterval(state.callTimerInterval); state.callTimerInterval = null; }
    state.isMuted = false; state.isCameraOff = false;
    dom.toggleMuteBtn.classList.remove('active'); dom.toggleCameraBtn.classList.remove('active');
    stopRingtone();
    dom.incomingModal.classList.remove('active');
    showScreen(dom.mainScreen);
  }

  function startCallTimer() {
    state.callStartTime = Date.now();
    dom.callTimer.style.display = 'block';
    dom.callTimer.textContent = '00:00';
    state.callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.callStartTime) / 1000);
      dom.callTimer.textContent = formatTime(elapsed);
    }, 1000);
  }

  function toggleMute() {
    if (!state.localStream) return;
    state.isMuted = !state.isMuted;
    state.localStream.getAudioTracks().forEach(t => t.enabled = !state.isMuted);
    dom.toggleMuteBtn.classList.toggle('active', state.isMuted);
  }

  function toggleCamera() {
    if (!state.localStream) return;
    const vt = state.localStream.getVideoTracks();
    if (!vt.length) return;
    state.isCameraOff = !state.isCameraOff;
    vt.forEach(t => t.enabled = !state.isCameraOff);
    dom.toggleCameraBtn.classList.toggle('active', state.isCameraOff);
    
    if (state.selectedUser) {
      state.socket.emit('camera-status', { to: state.selectedUser.name, isCameraOff: state.isCameraOff });
    }
  }

  // ============ SOCKET ============
  function initSocket() {
    state.socket = io({ reconnection: true, reconnectionAttempts: Infinity });

    state.socket.on('connect', () => {
      if (state.myName) {
        state.socket.emit('register', { userName: state.myName });
      }
    });

    state.socket.on('disconnect', () => state.socket.connect());
    state.socket.on('error-msg', (msg) => showToast('❌ ' + msg));

    state.socket.on('registered', ({ name }) => {
      state.myName = name;
      localStorage.setItem('8hub_name', name);
      dom.myInitialSidebar.textContent = getInitial(name);
      dom.myNameSidebar.textContent = name;
      showScreen(dom.mainScreen);
      showToast(`✅ Hoş geldin, ${name}!`);
    });

    state.socket.on('online-users-list', (onlineNames) => {
      state.onlineUsers = onlineNames;
      renderUserList();
      if (state.selectedUser) {
        const isOnline = onlineNames.includes(state.selectedUser.name);
        dom.chatPartnerStatus.textContent = isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
      }
    });

    // Friend Requests
    state.socket.on('friend-request-received', ({ from }) => {
      showToast(`👋 ${from} sana arkadaşlık isteği gönderdi!`);
      addFriend(from);
      state.socket.emit('accept-friend-request', { from });
      showToast(`✅ ${from} eklendi.`);
    });

    state.socket.on('friend-request-sent', ({ to }) => {
      showToast(`⏳ ${to} kullanıcısına istek gönderildi.`);
    });

    state.socket.on('friend-request-accepted', ({ by }) => {
      showToast(`🎉 ${by} arkadaşlık isteğini kabul etti!`);
      addFriend(by);
    });

    // Messaging
    state.socket.on('message-history', ({ withUser, messages }) => {
      state.chats[withUser] = messages;
      saveChats();
      if (state.selectedUser && state.selectedUser.name === withUser) {
        dom.messagesContainer.innerHTML = '';
        messages.forEach(msg => appendMessage(msg));
      }
    });

    state.socket.on('new-message', (msg) => {
      if (!msg.isViewOnce) {
        const partner = msg.from === state.myName ? msg.to : msg.from;
        if (!state.chats[partner]) state.chats[partner] = [];
        state.chats[partner].push(msg);
        saveChats();
      }

      const isCurrentChat = state.selectedUser && (
        (msg.from === state.selectedUser.name && msg.to === state.myName) ||
        (msg.from === state.myName && msg.to === state.selectedUser.name)
      );

      if (isCurrentChat) {
        appendMessage(msg);
        if (msg.from !== state.myName) state.socket.emit('mark-read', { fromUser: msg.from });
      }

      if (msg.from !== state.myName) {
        playMessageSound();
        if (document.hidden || !isCurrentChat) sendNotification(msg.from, msg.text || "Yeni mesaj");
      }
    });

    state.socket.on('messages-read', ({ by }) => {
      if (state.chats[by]) {
        state.chats[by].forEach(m => { if (m.from === state.myName) m.status = 'read'; });
        saveChats();
      }
      if (state.selectedUser && state.selectedUser.name === by) {
        dom.messagesContainer.querySelectorAll('.sent .read-receipt:not(.read)').forEach(el => el.classList.add('read'));
      }
    });

    state.socket.on('message-deleted', ({ messageId }) => {
      Object.keys(state.chats).forEach(partner => {
        const m = state.chats[partner].find(x => x.id === messageId);
        if (m) {
          m.text = ''; m.image = null; m.audio = null; m.isDeleted = true;
          saveChats();
        }
      });
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.className = 'message-bubble received';
        el.innerHTML = `<div style="font-style:italic; color:var(--text-muted);">🚫 Bu mesaj silindi</div>`;
      }
    });

    state.socket.on('user-typing', ({ name }) => {
      if (state.selectedUser && state.selectedUser.name === name) {
        dom.typingIndicator.style.display = 'flex'; dom.typingName.textContent = `${name} yazıyor...`;
      }
    });
    state.socket.on('user-stop-typing', ({ name }) => {
      if (state.selectedUser && state.selectedUser.name === name) dom.typingIndicator.style.display = 'none';
    });

    // WebRTC
    state.socket.on('incoming-call', (data) => {
      state.incomingCallData = data;
      dom.incomingCallerInitial.textContent = getInitial(data.callerName);
      dom.incomingCallerName.textContent = data.callerName;
      dom.incomingCallType.textContent = data.callType === 'video' ? '📹 Görüntülü arama...' : '📞 Sesli arama...';
      dom.incomingModal.classList.add('active');
    });

    state.socket.on('call-answered', async ({ answer }) => {
      if (state.peerConnection) {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        dom.callStatusText.textContent = 'Bağlandı!'; startCallTimer();
      }
    });

    state.socket.on('call-rejected', () => { showToast('❌ Arama reddedildi'); endCallCleanup(); });
    state.socket.on('call-ended', () => { showToast('📞 Arama sonlandırıldı'); endCallCleanup(); });
    state.socket.on('ice-candidate', async ({ candidate }) => {
      if (state.peerConnection && candidate) { try { await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {} }
    });
    state.socket.on('camera-status', ({ isCameraOff }) => {
      const overlay = document.getElementById('remote-camera-off-overlay');
      if (overlay) {
        if (isCameraOff) overlay.classList.remove('hidden');
        else overlay.classList.add('hidden');
      }
    });
  }

  // ============ EVENTS ============
  function bindEvents() {
    dom.appLayout = document.querySelector('.app-layout');
    
    // Login
    dom.userNameInput.addEventListener('input', () => { dom.joinBtn.disabled = dom.userNameInput.value.trim().length < 1; });
    dom.userNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !dom.joinBtn.disabled) dom.joinBtn.click(); });
    dom.joinBtn.addEventListener('click', () => {
      const name = dom.userNameInput.value.trim();
      if (!name) return;
      state.myName = name;
      state.socket.connect();
      if (state.socket.connected) {
        state.socket.emit('register', { userName: name });
      }
    });

    dom.logoutBtn.addEventListener('click', () => {
      if (state.inCall) endCall();
      state.selectedUser = null; state.myName = '';
      localStorage.removeItem('8hub_name');
      state.socket.disconnect(); showScreen(dom.loginScreen);
    });

    // Friend Modal
    dom.addFriendBtn.addEventListener('click', () => {
      dom.friendUsernameInput.value = ''; dom.addFriendModal.classList.add('active');
    });
    dom.cancelFriendBtn.addEventListener('click', () => dom.addFriendModal.classList.remove('active'));
    dom.sendFriendRequestBtn.addEventListener('click', () => {
      const un = dom.friendUsernameInput.value.trim();
      if (un) { state.socket.emit('send-friend-request', { to: un }); dom.addFriendModal.classList.remove('active'); }
    });

    // Search
    dom.searchUsers.addEventListener('input', () => renderUserList(dom.searchUsers.value));
    dom.backToSidebar.addEventListener('click', () => dom.appLayout.classList.remove('chat-open'));

    // Calls
    dom.topVideoBtn.addEventListener('click', () => startCall('video'));
    dom.topVoiceBtn.addEventListener('click', () => startCall('voice'));
    dom.toggleMuteBtn.addEventListener('click', toggleMute);
    dom.toggleCameraBtn.addEventListener('click', toggleCamera);
    dom.endCallBtn.addEventListener('click', endCall);
    dom.acceptBtn.addEventListener('click', answerCall);
    dom.rejectBtn.addEventListener('click', rejectCall);

    // Messaging
    dom.sendMsgBtn.addEventListener('click', () => sendMessage(dom.messageInput.value.trim()));
    dom.messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(dom.messageInput.value.trim()); });
    dom.messageInput.addEventListener('input', () => {
      if (state.selectedUser) {
        state.socket.emit('typing', { to: state.selectedUser.name });
        clearTimeout(state.typingTimeout);
        state.typingTimeout = setTimeout(() => state.socket.emit('stop-typing', { to: state.selectedUser.name }), 1500);
      }
    });

    // Image Upload
    dom.attachBtn.addEventListener('click', () => dom.imageInput.click());
    dom.imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return showToast('❌ Dosya çok büyük! Maksimum 5MB.');
      const reader = new FileReader();
      reader.onload = (ev) => {
        pendingImageBase64 = ev.target.result;
        dom.imagePreview.src = pendingImageBase64;
        dom.viewOnceCheckbox.checked = false;
        dom.imageUploadModal.classList.add('active');
      };
      reader.readAsDataURL(file);
    });
    dom.cancelImageBtn.addEventListener('click', () => { dom.imageUploadModal.classList.remove('active'); pendingImageBase64 = null; dom.imageInput.value=''; });
    dom.sendImageBtn.addEventListener('click', () => {
      if (pendingImageBase64) {
        const isViewOnce = dom.viewOnceCheckbox.checked;
        sendMessage('', pendingImageBase64, null, isViewOnce);
      }
      dom.imageUploadModal.classList.remove('active'); pendingImageBase64 = null; dom.imageInput.value='';
    });

    // Voice Record (Hold to record)
    dom.voiceRecordBtn.addEventListener('mousedown', startRecording);
    dom.voiceRecordBtn.addEventListener('mouseup', stopRecording);
    dom.voiceRecordBtn.addEventListener('mouseleave', () => { if (state.mediaRecorder && state.mediaRecorder.state === 'recording') stopRecording(); });
    // Touch support for mobile
    dom.voiceRecordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
    dom.voiceRecordBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
  }

  // ============ VOICE NOTES ============
  let recordAudioCtx, recordAnalyser, recordDataArray, recordAnimId;
  let recordStartTime, recordTimerId;

  function drawVisualizer() {
    const canvas = document.getElementById('recording-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    recordAnimId = requestAnimationFrame(drawVisualizer);
    recordAnalyser.getByteFrequencyData(recordDataArray);

    ctx.clearRect(0, 0, width, height);
    const barWidth = (width / recordDataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < recordDataArray.length; i++) {
      barHeight = recordDataArray[i] / 255 * height;
      ctx.fillStyle = `rgb(${recordDataArray[i] + 100}, 50, 250)`;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      x += barWidth + 2;
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream);
      state.audioChunks = [];
      
      // VISUALIZER
      recordAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = recordAudioCtx.createMediaStreamSource(stream);
      recordAnalyser = recordAudioCtx.createAnalyser();
      recordAnalyser.fftSize = 64;
      source.connect(recordAnalyser);
      recordDataArray = new Uint8Array(recordAnalyser.frequencyBinCount);
      
      document.getElementById('recording-overlay').classList.remove('hidden');
      recordStartTime = Date.now();
      document.getElementById('recording-time').textContent = '00:00';
      recordTimerId = setInterval(() => {
        const s = Math.floor((Date.now() - recordStartTime) / 1000);
        document.getElementById('recording-time').textContent = formatTime(s);
      }, 1000);
      drawVisualizer();

      state.mediaRecorder.ondataavailable = e => state.audioChunks.push(e.data);
      state.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (ev) => { sendMessage('', null, ev.target.result); };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };
      state.mediaRecorder.start();
      dom.voiceRecordBtn.classList.add('recording');
    } catch (e) {
      showToast('⚠️ Mikrofon izni reddedildi');
    }
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      state.mediaRecorder.stop();
      dom.voiceRecordBtn.classList.remove('recording');
      
      document.getElementById('recording-overlay').classList.add('hidden');
      clearInterval(recordTimerId);
      cancelAnimationFrame(recordAnimId);
      if (recordAudioCtx) { recordAudioCtx.close().catch(()=>{}); recordAudioCtx = null; }
    }
  }

  // ============ INIT ============
  function init() {
    try {
      requestNotificationPermission();
      loadFriends();
      loadChats();
      initSocket();
      bindEvents();
      const savedName = localStorage.getItem('8hub_name');
      if (savedName) { 
        dom.userNameInput.value = savedName; 
        dom.joinBtn.disabled = false;
        dom.joinBtn.click(); 
      }
    } catch (e) {
      alert("App.js Error: " + e.message + "\n" + e.stack);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
