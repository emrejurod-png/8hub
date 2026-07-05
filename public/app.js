/* ========================================
   8hub - App Logic
   ======================================== */
(function () {
  'use strict';

  // ============ STATE ============
  const state = {
    socket: null,
    myName: '',
    selectedUser: null, // { name, socketId }
    users: [],
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
    typingTimeout: null
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
    appLayout: null, // set after DOM
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
    toast: $('#toast')
  };

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // ============ HELPERS ============
  function getInitial(name) { return name ? name.charAt(0).toUpperCase() : '?'; }

  function showScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  function showToast(msg, duration = 3000) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('visible');
    setTimeout(() => dom.toast.classList.remove('visible'), duration);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============ RINGTONE ============
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

  // ============ NOTIFICATIONS ============
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

  // ============ USER LIST ============
  function renderUserList(filter = '') {
    const otherUsers = state.users.filter(u => u.name !== state.myName);
    const filtered = filter
      ? otherUsers.filter(u => u.name.toLowerCase().includes(filter.toLowerCase()))
      : otherUsers;

    if (filtered.length === 0) {
      dom.userList.innerHTML = `
        <div class="empty-users">
          <span class="empty-icon">👥</span>
          <p>${filter ? 'Kullanıcı bulunamadı' : 'Henüz kimse çevrimiçi değil'}</p>
        </div>`;
      return;
    }

    dom.userList.innerHTML = filtered.map(user => `
      <div class="user-item ${state.selectedUser && state.selectedUser.name === user.name ? 'active' : ''}"
           data-name="${escapeHtml(user.name)}" data-socket="${user.socketId}">
        <div class="user-item-avatar">
          ${getInitial(user.name)}
          <div class="user-online-dot"></div>
        </div>
        <div class="user-item-info">
          <h4>${escapeHtml(user.name)}</h4>
          <p>🟢 Çevrimiçi</p>
        </div>
      </div>
    `).join('');

    // Click handlers
    dom.userList.querySelectorAll('.user-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.name;
        const socketId = item.dataset.socket;
        selectUser({ name, socketId });
      });
    });
  }

  function selectUser(user) {
    state.selectedUser = user;

    // Update active state in list
    dom.userList.querySelectorAll('.user-item').forEach(item => {
      item.classList.toggle('active', item.dataset.name === user.name);
    });

    // Show chat panel
    dom.noChatSelected.style.display = 'none';
    dom.activeChat.style.display = 'flex';

    // Update chat header
    dom.chatPartnerInitial.textContent = getInitial(user.name);
    dom.chatPartnerName.textContent = user.name;
    dom.chatPartnerStatus.textContent = 'Çevrimiçi';

    // Mobile: show chat
    dom.appLayout.classList.add('chat-open');

    // Clear and load messages
    dom.messagesContainer.innerHTML = `
      <div class="empty-chat">
        <span class="empty-icon">💬</span>
        <p>Henüz mesaj yok. İlk mesajı sen gönder!</p>
      </div>`;

    state.socket.emit('get-messages', { withUser: user.name });
    
    // Mark messages as read when opening chat
    state.socket.emit('mark-read', { fromUser: user.name });

    // Focus input
    dom.messageInput.focus();
  }

  // ============ MESSAGING ============
  function appendMessage(msg) {
    const isMine = msg.from === state.myName;
    const time = new Date(msg.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // Remove empty placeholder
    const empty = dom.messagesContainer.querySelector('.empty-chat');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `message-bubble ${isMine ? 'sent' : 'received'}`;
    
    let ticks = '';
    if (isMine) {
      ticks = `<span class="read-receipt ${msg.status === 'read' ? 'read' : ''}">✓✓</span>`;
    }

    div.innerHTML = `
      <div>${escapeHtml(msg.text)}</div>
      <div class="message-meta"><span>${time}</span>${ticks}</div>
    `;
    dom.messagesContainer.appendChild(div);
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
  }

  function sendMessage() {
    const text = dom.messageInput.value.trim();
    if (!text || !state.selectedUser) return;
    state.socket.emit('send-message', { to: state.selectedUser.name, text });
    dom.messageInput.value = '';
    state.socket.emit('stop-typing', { to: state.selectedUser.name });
  }

  // ============ WEBRTC CALLS ============
  async function startCall(callType) {
    if (!state.selectedUser) { showToast('⚠️ Önce birini seç!'); return; }
    state.callType = callType;
    state.inCall = true;

    dom.callPartnerInitial.textContent = getInitial(state.selectedUser.name);
    dom.callPartnerNameDisplay.textContent = state.selectedUser.name;
    dom.callStatusText.textContent = 'Arıyor...';
    dom.callTimer.style.display = 'none';
    dom.callStatusOverlay.classList.remove('hidden');
    showScreen(dom.callScreen);

    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: callType === 'video'
      });
      dom.localVideo.srcObject = state.localStream;
      dom.localVideo.style.display = callType === 'video' ? 'block' : 'none';

      createPeerConnection();
      state.localStream.getTracks().forEach(t => state.peerConnection.addTrack(t, state.localStream));

      const offer = await state.peerConnection.createOffer();
      await state.peerConnection.setLocalDescription(offer);

      state.socket.emit('call-user', {
        to: state.selectedUser.name,
        offer: state.peerConnection.localDescription,
        callerName: state.myName,
        callType
      });
    } catch (err) {
      console.error('Arama hatası:', err);
      showToast('❌ Kamera/mikrofon erişimi reddedildi!');
      endCallCleanup();
    }
  }

  async function answerCall() {
    if (!state.incomingCallData) return;
    const data = state.incomingCallData;
    state.inCall = true;
    state.incomingCallData = null;

    dom.incomingModal.classList.remove('active');
    stopRingtone();

    dom.callPartnerInitial.textContent = getInitial(data.callerName);
    dom.callPartnerNameDisplay.textContent = data.callerName;
    dom.callStatusText.textContent = 'Bağlanıyor...';
    dom.callTimer.style.display = 'none';
    dom.callStatusOverlay.classList.remove('hidden');
    showScreen(dom.callScreen);

    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: data.callType === 'video'
      });
      dom.localVideo.srcObject = state.localStream;
      dom.localVideo.style.display = data.callType === 'video' ? 'block' : 'none';

      createPeerConnection();
      state.localStream.getTracks().forEach(t => state.peerConnection.addTrack(t, state.localStream));

      await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);

      state.socket.emit('answer-call', {
        to: data.from,
        answer: state.peerConnection.localDescription
      });
      startCallTimer();
    } catch (err) {
      console.error('Cevaplama hatası:', err);
      showToast('❌ Kamera/mikrofon erişimi reddedildi!');
      endCallCleanup();
    }
  }

  function rejectCall() {
    if (!state.incomingCallData) return;
    state.socket.emit('reject-call', { to: state.incomingCallData.from });
    state.incomingCallData = null;
    dom.incomingModal.classList.remove('active');
    stopRingtone();
  }

  function createPeerConnection() {
    state.peerConnection = new RTCPeerConnection(iceServers);

    state.peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        const target = state.selectedUser?.socketId || state.incomingCallData?.from;
        if (target) state.socket.emit('ice-candidate', { to: target, candidate: e.candidate });
      }
    };

    state.peerConnection.ontrack = (e) => {
      state.remoteStream = e.streams[0];
      dom.remoteVideo.srcObject = state.remoteStream;
      dom.remoteVideo.onloadedmetadata = () => {
        if (state.callType === 'video') dom.callStatusOverlay.classList.add('hidden');
      };
    };

    state.peerConnection.onconnectionstatechange = () => {
      const s = state.peerConnection.connectionState;
      if (s === 'connected') { dom.callStatusText.textContent = 'Bağlandı!'; }
      else if (s === 'disconnected' || s === 'failed') { showToast('⚠️ Bağlantı kesildi'); endCallCleanup(); }
    };
  }

  function endCall() {
    const target = state.selectedUser?.socketId || state.incomingCallData?.from;
    if (target) state.socket.emit('end-call', { to: target });
    endCallCleanup();
  }

  function endCallCleanup() {
    state.inCall = false;
    if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
    if (state.peerConnection) { state.peerConnection.close(); state.peerConnection = null; }
    dom.localVideo.srcObject = null;
    dom.remoteVideo.srcObject = null;
    if (state.callTimerInterval) { clearInterval(state.callTimerInterval); state.callTimerInterval = null; }
    state.isMuted = false; state.isCameraOff = false;
    dom.toggleMuteBtn.classList.remove('active');
    dom.toggleCameraBtn.classList.remove('active');
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
  }

  // ============ SOCKET ============
  function initSocket() {
    state.socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 10000
    });

    state.socket.on('connect', () => {
      console.log('✅ Bağlandı');
      // Auto re-register on reconnect if we were already logged in
      if (state.myName && !dom.loginScreen.classList.contains('active')) {
        state.socket.emit('register', { userName: state.myName });
      }
    });

    state.socket.on('disconnect', (reason) => {
      console.log('❌ Bağlantı kesildi:', reason);
      if (reason === 'io server disconnect') {
        // Server kicked us, reconnect manually
        state.socket.connect();
      }
      // Don't spam toast on every reconnect attempt
    });

    state.socket.on('reconnect_failed', () => showToast('⚠️ Sunucuya bağlanılamıyor!'));
    state.socket.on('error-msg', (msg) => showToast('❌ ' + msg));

    state.socket.on('registered', ({ name }) => {
      const wasAlreadyLoggedIn = state.myName === name && !dom.loginScreen.classList.contains('active');
      state.myName = name;
      dom.myInitialSidebar.textContent = getInitial(name);
      dom.myNameSidebar.textContent = name;
      if (!wasAlreadyLoggedIn) {
        showScreen(dom.mainScreen);
        showToast(`✅ Hoş geldin, ${name}!`);
      }
    });

    state.socket.on('user-list', (users) => {
      state.users = users;
      renderUserList(dom.searchUsers.value);

      // Update selected user socketId (it may have changed on reconnect)
      if (state.selectedUser) {
        const updated = users.find(u => u.name === state.selectedUser.name);
        if (updated) {
          state.selectedUser.socketId = updated.socketId;
        } else {
          // Selected user went offline
          dom.chatPartnerStatus.textContent = 'Çevrimdışı';
        }
      }
    });

    state.socket.on('user-joined-notification', ({ name }) => {
      showToast(`🟢 ${name} çevrimiçi oldu`);
      if (document.hidden) sendNotification('8hub', `${name} çevrimiçi oldu`);
    });

    state.socket.on('user-left-notification', ({ name }) => {
      showToast(`🔴 ${name} ayrıldı`);
      if (state.selectedUser && state.selectedUser.name === name) {
        dom.chatPartnerStatus.textContent = 'Çevrimdışı';
      }
    });

    state.socket.on('message-history', ({ withUser, messages }) => {
      dom.messagesContainer.innerHTML = '';
      if (!messages || messages.length === 0) {
        dom.messagesContainer.innerHTML = `
          <div class="empty-chat">
            <span class="empty-icon">💬</span>
            <p>Henüz mesaj yok. İlk mesajı sen gönder!</p>
          </div>`;
      } else {
        messages.forEach(msg => appendMessage(msg));
      }
    });

    state.socket.on('new-message', (msg) => {
      // If this message is for the currently open chat
      const isCurrentChat = state.selectedUser && (
        (msg.from === state.selectedUser.name && msg.to === state.myName) ||
        (msg.from === state.myName && msg.to === state.selectedUser.name)
      );

      if (isCurrentChat) {
        appendMessage(msg);
        if (msg.from !== state.myName) {
          // Mark as read immediately if chat is open
          state.socket.emit('mark-read', { fromUser: msg.from });
        }
      }

      if (msg.from !== state.myName) {
        playMessageSound();
        if (document.hidden || !isCurrentChat) {
          sendNotification(msg.from, msg.text);
        }
      }
    });

    state.socket.on('messages-read', ({ by }) => {
      // Update UI to show blue ticks if chat is open with that user
      if (state.selectedUser && state.selectedUser.name === by) {
        const receipts = dom.messagesContainer.querySelectorAll('.sent .read-receipt:not(.read)');
        receipts.forEach(el => el.classList.add('read'));
      }
    });

    state.socket.on('user-typing', ({ name }) => {
      if (state.selectedUser && state.selectedUser.name === name) {
        dom.typingIndicator.style.display = 'flex';
        dom.typingName.textContent = `${name} yazıyor...`;
      }
    });

    state.socket.on('user-stop-typing', ({ name }) => {
      if (state.selectedUser && state.selectedUser.name === name) {
        dom.typingIndicator.style.display = 'none';
      }
    });

    // Call events
    state.socket.on('incoming-call', (data) => {
      state.incomingCallData = data;
      state.callType = data.callType;
      // Find the caller's socketId and set as selected for ICE
      const caller = state.users.find(u => u.name === data.callerName);
      if (caller) state.selectedUser = { name: caller.name, socketId: data.from };

      dom.incomingCallerInitial.textContent = getInitial(data.callerName);
      dom.incomingCallerName.textContent = data.callerName;
      dom.incomingCallType.textContent = data.callType === 'video' ? '📹 Görüntülü arama...' : '📞 Sesli arama...';
      dom.incomingModal.classList.add('active');
      startRingtone();
      sendNotification(`${data.callerName} arıyor!`, data.callType === 'video' ? 'Görüntülü arama' : 'Sesli arama');
    });

    state.socket.on('call-answered', async ({ from, answer }) => {
      if (state.peerConnection) {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        dom.callStatusText.textContent = 'Bağlandı!';
        startCallTimer();
      }
    });

    state.socket.on('call-rejected', () => { showToast('❌ Arama reddedildi'); endCallCleanup(); });
    state.socket.on('call-ended', () => { showToast('📞 Arama sonlandırıldı'); endCallCleanup(); });

    state.socket.on('ice-candidate', async ({ from, candidate }) => {
      if (state.peerConnection && candidate) {
        try { await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
      }
    });
  }

  // ============ EVENTS ============
  function bindEvents() {
    dom.appLayout = document.querySelector('.app-layout');

    // Login
    dom.userNameInput.addEventListener('input', () => {
      dom.joinBtn.disabled = dom.userNameInput.value.trim().length < 1;
    });

    dom.joinBtn.addEventListener('click', () => {
      const name = dom.userNameInput.value.trim();
      if (!name) return;
      localStorage.setItem('8hub_name', name);
      state.socket.emit('register', { userName: name });
      requestNotificationPermission();
    });

    dom.userNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !dom.joinBtn.disabled) dom.joinBtn.click();
    });

    // Logout
    dom.logoutBtn.addEventListener('click', () => {
      if (state.inCall) endCall();
      state.selectedUser = null;
      state.myName = ''; // Clear name so reconnect doesn't auto-register
      state.socket.disconnect();
      state.socket.connect();
      showScreen(dom.loginScreen);
    });

    // Search users
    dom.searchUsers.addEventListener('input', () => {
      renderUserList(dom.searchUsers.value);
    });

    // Back button (mobile)
    dom.backToSidebar.addEventListener('click', () => {
      dom.appLayout.classList.remove('chat-open');
    });

    // Call buttons
    dom.topVideoBtn.addEventListener('click', () => startCall('video'));
    dom.topVoiceBtn.addEventListener('click', () => startCall('voice'));

    // Call controls
    dom.toggleMuteBtn.addEventListener('click', toggleMute);
    dom.toggleCameraBtn.addEventListener('click', toggleCamera);
    dom.endCallBtn.addEventListener('click', endCall);

    // Incoming call
    dom.acceptBtn.addEventListener('click', answerCall);
    dom.rejectBtn.addEventListener('click', rejectCall);

    // Messaging
    dom.sendMsgBtn.addEventListener('click', sendMessage);
    dom.messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    dom.messageInput.addEventListener('input', () => {
      if (state.selectedUser) {
        state.socket.emit('typing', { to: state.selectedUser.name });
        clearTimeout(state.typingTimeout);
        state.typingTimeout = setTimeout(() => {
          if (state.selectedUser) state.socket.emit('stop-typing', { to: state.selectedUser.name });
        }, 1500);
      }
    });
  }

  // ============ RESTORE & INIT ============
  function restoreSession() {
    const savedName = localStorage.getItem('8hub_name');
    if (savedName) dom.userNameInput.value = savedName;
    dom.userNameInput.dispatchEvent(new Event('input'));
  }

  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  function init() {
    initSocket();
    bindEvents();
    restoreSession();
    registerSW();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
