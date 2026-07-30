/* ═══════════════════════════════════════════════════════════
   Pulse Messenger — app.js (fixed edition)
   Fixes: formatVoiceDur syntax, template literal bugs,
          addContact/removeContact inline calls, touch events
   ═══════════════════════════════════════════════════════════ */

let TOKEN = localStorage.getItem('pulse_token');
let ME = null, socket = null;
let currentChat = null, currentChatType = null, currentOtherId = null;
let replyTo = null, editingMsg = null;
let allChats = [], selectedMembers = [];
let msgOffset = 0, hasMore = false;
let typingTimerOut = null;
let ctxMsgData = null;

// WebRTC
let peerConn = null, localStream = null, remoteStream = null;
let callType = null, callTargetUid = null, incomingCallData = null;
let callTimerInterval = null, callSeconds = 0;
let isMuted = false, isCamOff = false;

// Voice recording
let mediaRec = null, voiceChunks = [], isRecording = false;
let voiceSeconds = 0, voiceTimer = null;

// P2P file transfer (WebRTC DataChannel — file never touches the server)
const P2P_CHUNK_SIZE = 16 * 1024;          // 16KB, safe across browsers
const P2P_BUFFER_THRESHOLD = 1 * 1024 * 1024; // pause sending above 1MB buffered
let filePeerConn = null, fileDataChannel = null;
let p2pTransfer = null;   // { id, direction:'send'|'recv', file, filename, size, mime, receivedChunks, receivedBytes, toUid }

const EMOJIS = ['😀','😂','😍','🥰','😎','🤔','😴','🥳','🎉','❤️','👍','👎','🔥','✨','🎯','💯',
  '🙈','🤝','🫡','😭','🤣','😊','😋','🤩','🥹','😤','🫠','💀','🤡','👻','🎃','🌟','💫','⚡',
  '🌈','🎵','🎮','🏆','💎','🔮','🌙','☀️','🌊','🍕','🍔','🍟','🧋','☕','🎂','🍭','🚀','✈️','🎁'];

const ICE_SERVERS = {iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};

// ─── UTILS ────────────────────────────────────────────────────────────────────
const qs  = s => document.querySelector(s);
const qsa = s => document.querySelectorAll(s);
const val = id => qs('#'+id)?.value || '';
const setText = (id,t) => { const el=qs('#'+id); if(el) el.textContent=t; };

function esc(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(str){
  return String(str||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// Renders a real uploaded photo as the avatar background when present,
// otherwise falls back to the existing colored-initial look.
function avatarAttr(url){
  return url ? ` style="background-image:url('${escAttr(url)}');background-size:cover;background-position:center"` : '';
}
function avatarInner(url,initial,onlineDot){
  return `${url?'':esc(initial)}${onlineDot||''}`;
}
function formatTime(iso){
  if (!iso) return '';
  const d=new Date(iso), now=new Date();
  if (d.toDateString()===now.toDateString())
    return d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
}
// FIX: was missing closing backtick in original
function formatVoiceDur(s){
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}
function showToast(msg,dur=3000){
  const t=qs('#toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),dur);
}
function fileIcon(ext){
  const m={pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📋',pptx:'📋',
    zip:'🗜️',rar:'🗜️',mp3:'🎵',mp4:'🎬',jpg:'🖼️',png:'🖼️',gif:'🖼️',webp:'🖼️'};
  return m[ext]||'📎';
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body){
  const opts={method,headers:{'Content-Type':'application/json'}};
  if (TOKEN) opts.headers['Authorization']='Bearer '+TOKEN;
  if (body) opts.body=JSON.stringify(body);
  try{
    const r=await fetch('/api'+path,opts);
    return r.json();
  }catch(e){console.error('API error',e);return{error:'Network error'};}
}

async function uploadFile(file, onProgress){
  const fd=new FormData(); fd.append('file',file);
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST','/api/upload');
    xhr.setRequestHeader('Authorization','Bearer '+TOKEN);
    xhr.upload.onprogress=e=>{if(e.lengthComputable&&onProgress)onProgress(e.loaded/e.total*100);};
    xhr.onload=()=>resolve(JSON.parse(xhr.responseText));
    xhr.onerror=()=>reject(new Error('Upload failed'));
    xhr.send(fd);
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async()=>{
  setupEmojis();
  document.addEventListener('click',e=>{
    if (!e.target.closest('#emoji-picker')&&!e.target.closest('[onclick="openEmojiPicker()"]'))
      qs('#emoji-picker').classList.add('hidden');
    if (e.target.classList.contains('modal'))
      e.target.classList.add('hidden');
    if (!e.target.closest('.ctx-menu')&&!e.target.closest('.msg-bubble'))
      qs('#msg-ctx-menu').classList.add('hidden');
  });
  qs('#login-password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  qs('#message-input')?.addEventListener('keydown',handleMsgKey);
  if (TOKEN){
    const data=await api('GET','/me');
    if (data.id){ME=data;showApp();}
    else{TOKEN=null;localStorage.removeItem('pulse_token');}
  }
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function showLogin(){qs('#login-form').classList.remove('hidden');qs('#register-form').classList.add('hidden');}
function showRegister(){qs('#register-form').classList.remove('hidden');qs('#login-form').classList.add('hidden');}

async function doLogin(){
  const username=val('login-username'),password=val('login-password');
  setText('login-error','');
  if (!username||!password){setText('login-error','Заполните все поля');return;}
  const d=await api('POST','/login',{username,password});
  if (d.error){setText('login-error',d.error);return;}
  TOKEN=d.token;ME=d.user;localStorage.setItem('pulse_token',TOKEN);showApp();
}
async function doRegister(){
  const first_name=val('reg-firstname'),last_name=val('reg-lastname'),
    username=val('reg-username'),password=val('reg-password');
  setText('reg-error','');
  if (!first_name||!last_name||!username||!password){setText('reg-error','Заполните все поля');return;}
  const d=await api('POST','/register',{first_name,last_name,username,password});
  if (d.error){setText('reg-error',d.error);return;}
  TOKEN=d.token;ME=d.user;localStorage.setItem('pulse_token',TOKEN);showApp();
}
async function doLogout(){
  await api('POST','/logout');
  TOKEN=null;ME=null;localStorage.removeItem('pulse_token');
  if (socket)socket.disconnect();
  qs('#app-screen').classList.remove('active');
  qs('#auth-screen').classList.add('active');
  showLogin();
}

// ─── APP ──────────────────────────────────────────────────────────────────────
function showApp(){
  qs('#auth-screen').classList.remove('active');
  qs('#app-screen').classList.add('active');
  applyTheme(ME.theme||'dark');
  loadChats();
  connectSocket();
}

function connectSocket(){
  socket=io({query:{token:TOKEN}});
  socket.on('connected',d=>console.log('WS connected',d.uid));
  socket.on('new_message',msg=>{
    if (msg.chat_id===currentChat){appendMessage(msg);scrollToBottom();loadChats();}
    else{loadChats();showToast('💬 Новое сообщение');}
  });
  socket.on('message_deleted',({chat_id,msg_id})=>{
    if (chat_id===currentChat){const el=qs('#msg-'+msg_id);if(el)el.remove();}
  });
  socket.on('message_edited',msg=>{
    if (msg.chat_id===currentChat){
      const el=qs('#msg-'+msg.id);
      if (el){
        const tb=el.querySelector('.msg-text');
        if (tb)tb.textContent=msg.text;
        const meta=el.querySelector('.msg-meta');
        if (meta&&!meta.querySelector('.msg-edited')){
          const span=document.createElement('span');
          span.className='msg-edited';span.textContent='ред.';
          meta.appendChild(span);
        }
      }
    }
  });
  socket.on('typing',d=>{if(d.chat_id===currentChat&&d.user_id!==ME.id)showTypingIndicator(d.name);});
  socket.on('incoming_call',handleIncomingCall);
  socket.on('call_answered',handleCallAnswered);
  socket.on('call_rejected',()=>{showToast('📵 Звонок отклонён');hideCallOverlay();});
  socket.on('call_ended',()=>{showToast('Звонок завершён');cleanupCall();hideCallOverlay();});
  socket.on('call_failed',d=>{showToast('❌ '+d.reason);hideCallOverlay();});
  socket.on('ice_candidate',async d=>{
    if (peerConn&&d.candidate){
      try{await peerConn.addIceCandidate(new RTCIceCandidate(d.candidate));}catch(e){}
    }
  });
  socket.on('p2p_file_offer',handleP2PFileOfferIncoming);
  socket.on('p2p_file_answer',handleP2PFileAnswer);
  socket.on('p2p_file_rejected',()=>{showToast('📵 Получатель отклонил передачу файла');cleanupP2PTransfer();});
  socket.on('p2p_file_cancelled',()=>{showToast('Передача файла отменена');cleanupP2PTransfer();});
  socket.on('p2p_file_failed',d=>{showToast('❌ '+d.reason);cleanupP2PTransfer();});
  socket.on('user_updated',d=>{
    loadChats();
    if(currentOtherId===d.uid)openChat(currentChat,currentChatType,qs('#chat-header-name').textContent,currentOtherId);
  });
  socket.on('contact_added',d=>{
    showToast(`👤 ${d.by.first_name} ${d.by.last_name} добавил(а) вас в контакты`);
    renderContactsList();
    loadChats();
  });
  socket.on('p2p_file_ice',async d=>{
    if (filePeerConn&&d.candidate){
      try{await filePeerConn.addIceCandidate(new RTCIceCandidate(d.candidate));}catch(e){}
    }
  });
}

// ─── THEME ────────────────────────────────────────────────────────────────────
function applyTheme(t){
  document.body.className=t;
  qs('#theme-btn').textContent=t==='dark'?'☀️':'🌙';
}
async function toggleTheme(){
  const t=document.body.classList.contains('dark')?'light':'dark';
  applyTheme(t);await api('POST','/me/update',{theme:t});ME.theme=t;
}

// ─── CHATS ────────────────────────────────────────────────────────────────────
async function loadChats(){
  const data=await api('GET','/chats');
  if (Array.isArray(data)) allChats=data;
  renderChatList(allChats);
}

function renderChatList(chats){
  const tab=currentTabName();
  let list=chats;
  if (tab==='groups')list=chats.filter(c=>c.type==='group');
  else if (tab==='channels')list=chats.filter(c=>c.type==='channel');
  else if (tab==='contacts'){renderContactsList();return;}
  else list=chats.filter(c=>c.type==='dm');

  const el=qs('#chat-list');
  if (!list.length){
    const hints={chats:'Начните переписку',groups:'Создайте группу',channels:'Найдите или создайте канал'};
    const icons={chats:'💬',groups:'👥',channels:'📢'};
    el.innerHTML=`<div class="chat-empty">
      <div class="chat-empty-icon">${icons[tab]||'💬'}</div>
      <p>${hints[tab]||''}</p>
      ${tab==='channels'?`<button class="btn-sm" onclick="openPublicChannels()">Каталог каналов</button>`:''}
    </div>`;
    return;
  }
  el.innerHTML=list.map(c=>{
    const init=c.name?c.name[0].toUpperCase():'?';
    const ac=c.type==='group'?'group-avatar':c.type==='channel'?'channel-avatar':'';
    const online=c.type==='dm'&&c.online?'<div class="online-dot"></div>':'';
    const lastMsg=c.last_message?getLastMsgPreview(c.last_message):'Нет сообщений';
    const time=c.last_message?formatTime(c.last_message.timestamp):'';
    const badge=c.unread?`<span class="unread-badge">${c.unread}</span>`:'';
    const prefix=c.type==='group'?'👥 ':c.type==='channel'?'📢 ':'';
    const isActive=currentChat===c.id?'active':'';
    return `<div class="chat-item ${isActive}" onclick="openChat('${c.id}','${c.type}','${escAttr(c.name)}','${c.other_id||''}')">
      <div class="chat-avatar ${ac}"${avatarAttr(c.avatar)}>${avatarInner(c.avatar,init,online)}</div>
      <div class="chat-info">
        <div class="chat-name">${prefix}${esc(c.name)}</div>
        <div class="chat-last">${esc(lastMsg)}</div>
      </div>
      <div class="chat-meta"><span class="chat-time">${time}</span>${badge}</div>
    </div>`;
  }).join('');
}

function getLastMsgPreview(msg){
  if (msg.voice)return '🎤 Голосовое';
  if (msg.p2p_file)return '📡 P2P файл';
  if (msg.attachment){
    const icons={image:'🖼️ Изображение',video:'🎬 Видео',audio:'🎵 Аудио',file:'📎 Файл'};
    return icons[msg.attachment.type]||'📎 Файл';
  }
  return msg.text||'';
}

async function renderContactsList(){
  const contacts=await api('GET','/contacts');
  const el=qs('#chat-list');
  if (!contacts.length){
    el.innerHTML=`<div class="chat-empty"><div class="chat-empty-icon">👤</div><p>Нет контактов</p></div>`;
    return;
  }
  el.innerHTML=contacts.map(u=>{
    const cid=[ME.id,u.id].sort().join('_');
    return `<div class="chat-item" onclick="openChat('${cid}','dm','${escAttr(u.first_name+' '+u.last_name)}','${u.id}')">
      <div class="chat-avatar"${avatarAttr(u.avatar)}>${avatarInner(u.avatar,u.first_name[0],u.online?'<div class="online-dot"></div>':'')}</div>
      <div class="chat-info">
        <div class="chat-name">${esc(u.first_name)} ${esc(u.last_name)}</div>
        <div class="chat-last">@${u.username} · #${u.number}</div>
      </div>
    </div>`;
  }).join('');
}

function filterChats(q){
  if (!q)renderChatList(allChats);
  else renderChatList(allChats.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())));
}

let _currentTab='chats';
function currentTabName(){return _currentTab;}
function switchTab(tab){
  _currentTab=tab;
  qsa('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  renderChatList(allChats);
}

// ─── OPEN CHAT ────────────────────────────────────────────────────────────────
async function openChat(chatId,type,name,otherId=''){
  currentChat=chatId;currentChatType=type;currentOtherId=otherId;
  replyTo=null;editingMsg=null;msgOffset=0;
  qs('#reply-preview').classList.add('hidden');
  qs('#edit-preview').classList.add('hidden');
  qs('#message-input').value='';

  if (window.innerWidth<=768)qs('#sidebar').classList.add('hidden-mobile');
  qs('#empty-state').classList.add('hidden');
  qs('#chat-view').classList.remove('hidden');

  const nameEl=qs('#chat-header-name');nameEl.textContent=name;
  const avEl=qs('#chat-header-avatar');
  const chat0=allChats.find(c=>c.id===chatId);
  avEl.style.backgroundImage=chat0?.avatar?`url('${chat0.avatar}')`:'';
  avEl.style.backgroundSize='cover';avEl.style.backgroundPosition='center';
  avEl.textContent=chat0?.avatar?'':name[0].toUpperCase();
  avEl.className='chat-avatar-sm';
  if (type==='group')avEl.classList.add('group-avatar');
  if (type==='channel')avEl.classList.add('channel-avatar');

  const statusEl=qs('#chat-header-status');
  const chat=allChats.find(c=>c.id===chatId);
  if (type==='dm'){
    if (chat?.online){statusEl.textContent='в сети';statusEl.className='chat-header-status';}
    else{statusEl.textContent='не в сети';statusEl.className='chat-header-status offline';}
  }else if (type==='group'){
    statusEl.textContent=`${chat?.members||0} участников`;statusEl.className='chat-header-status offline';
  }else{
    statusEl.textContent=`${chat?.subscribers||0} подписчиков`;statusEl.className='chat-header-status offline';
  }

  qsa('.call-btn').forEach(b=>b.style.display=type==='dm'?'flex':'none');
  const p2pBtn=qs('#p2p-file-btn');
  if (p2pBtn) p2pBtn.style.display=(type==='dm'&&chat?.online)?'flex':'none';

  const inputArea=qs('#message-input-area');
  if (type==='channel'&&chat&&!chat.is_owner)inputArea.style.display='none';
  else inputArea.style.display='';

  if (socket)socket.emit('join',{room:chatId});
  await loadMessages(chatId,true);
  renderChatList(allChats);
}

function closeChat(){
  qs('#sidebar').classList.remove('hidden-mobile');
  qs('#chat-view').classList.add('hidden');
  qs('#empty-state').classList.remove('hidden');
  currentChat=null;
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
async function loadMessages(chatId,reset=false){
  if (reset){qs('#messages-list').innerHTML='';msgOffset=0;}
  const data=await api('GET',`/messages/${chatId}?offset=${msgOffset}&limit=50`);
  const msgs=data.messages||[];
  hasMore=data.has_more||false;
  qs('#load-more-btn').classList.toggle('hidden',!hasMore);

  const list=qs('#messages-list');
  let lastDate='';
  const frag=document.createDocumentFragment();

  msgs.forEach(msg=>{
    const d=new Date(msg.timestamp).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
    if (d!==lastDate){
      const sep=document.createElement('div');sep.className='msg-date-sep';
      sep.innerHTML=`<span>${d}</span>`;frag.appendChild(sep);lastDate=d;
    }
    frag.appendChild(buildMsgEl(msg));
  });

  if (reset){list.appendChild(frag);scrollToBottom();}
  else{list.insertBefore(frag,list.firstChild);}
}

async function loadMoreMessages(){
  if (!currentChat||!hasMore)return;
  msgOffset+=50;
  const container=qs('#messages-container');
  const oldH=container.scrollHeight;
  await loadMessages(currentChat,false);
  container.scrollTop=container.scrollHeight-oldH;
}

function buildMsgEl(msg){
  const isOut=msg.sender_id===ME.id;
  const div=document.createElement('div');
  div.className=`message ${isOut?'out':'in'}`;
  div.id='msg-'+msg.id;

  const time=new Date(msg.timestamp).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const senderHtml=!isOut&&currentChatType!=='dm'
    ?`<div class="msg-sender">${esc(msg.sender_name)}</div>`:'';
  const replyHtml=msg.reply_to
    ?`<div class="msg-reply-preview" onclick="scrollToMsg('${msg.reply_to.id}')">↩ ${esc((msg.reply_to.text||'').slice(0,50))}</div>`:'';
  const editedHtml=msg.edited?`<span class="msg-edited">ред.</span>`:'';
  const checkHtml=isOut?' ✓':'';

  let contentHtml='';
  if (msg.voice){
    const bars=Array.from({length:20},(_,i)=>{
      const h=Math.floor(Math.random()*14)+3;
      return `<div class="voice-bar" style="height:${h}px"></div>`;
    }).join('');
    contentHtml=`<div class="voice-msg">
      <button onclick="playVoice(this,'${msg.voice}')">▶</button>
      <div class="voice-waveform">${bars}</div>
      <span class="voice-duration">${msg.voice_dur||'0:00'}</span>
    </div>`;
  }else if (msg.attachment){
    const a=msg.attachment;
    const meta=a.meta||{};
    const metaBits=[];
    if (meta.width&&meta.height) metaBits.push(`${meta.width}×${meta.height}`);
    if (meta.duration_fmt) metaBits.push(`⏱ ${meta.duration_fmt}`);
    if (meta.pages) metaBits.push(`📄 ${meta.pages} стр.`);
    if (meta.exif) metaBits.push(`🏷️ EXIF`);
    if (a.verified===false) metaBits.push(`⚠️ не проверено`);
    const metaHtml=metaBits.length?`<div class="msg-file-meta">${metaBits.join(' · ')}</div>`:'';
    if (a.type==='image')
      contentHtml=`<img class="msg-image" src="${a.url}" alt="${esc(a.filename)}" onclick="openMedia('${a.url}','image')" loading="lazy">${metaHtml}`;
    else if (a.type==='video')
      contentHtml=`<video class="msg-video" controls preload="none" src="${a.url}"></video>${metaHtml}`;
    else if (a.type==='audio')
      contentHtml=`<div class="msg-audio"><audio controls src="${a.url}"></audio></div>${metaHtml}`;
    else
      contentHtml=`<a class="msg-file" href="${a.url}" download="${esc(a.filename)}" target="_blank">
        <div class="msg-file-icon">${fileIcon(a.ext||'')}</div>
        <div class="msg-file-info">
          <div class="msg-file-name">${esc(a.filename)}</div>
          <div class="msg-file-size">${esc(a.size_fmt||'')}</div>
          ${metaHtml}
        </div>
        <span>⬇️</span></a>`;
    if (msg.text)contentHtml+=`<div class="msg-text">${esc(msg.text)}</div>`;
  }else if (msg.p2p_file){
    const p=msg.p2p_file;
    contentHtml=`<div class="msg-file p2p-file">
        <div class="msg-file-icon">📡</div>
        <div class="msg-file-info">
          <div class="msg-file-name">${esc(p.filename)}</div>
          <div class="msg-file-size">${esc(p.size_fmt||'')} · передано P2P напрямую</div>
        </div>
      </div>`;
  }else{
    contentHtml=`<div class="msg-text">${esc(msg.text)}</div>`;
  }

  div.innerHTML=`${senderHtml}
    <div class="msg-bubble" oncontextmenu="showCtxMenu(event,'${msg.id}','${escAttr(msg.text||'')}',${isOut})">
      ${replyHtml}${contentHtml}
    </div>
    <div class="msg-meta">${time}${checkHtml} ${editedHtml}</div>`;
  div.addEventListener('dblclick',()=>setReply(msg));
  return div;
}

function appendMessage(msg){
  qs('#messages-list').appendChild(buildMsgEl(msg));
}

async function sendMessage(){
  const input=qs('#message-input');
  const text=input.value.trim();
  if (!currentChat)return;
  if (!text&&!replyTo&&!editingMsg)return;

  if (editingMsg){
    if (!text){cancelEdit();return;}
    await api('PATCH',`/messages/${currentChat}/${editingMsg.id}`,{text});
    cancelEdit();input.value='';input.style.height='';return;
  }

  if (!text)return;
  const body={text};
  if (replyTo)body.reply_to={id:replyTo.id,text:replyTo.text,sender_name:replyTo.sender_name};
  input.value='';input.style.height='';cancelReply();
  await api('POST',`/messages/${currentChat}`,body);
  loadChats();
}

function handleMsgKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}
function scrollToBottom(){const c=qs('#messages-container');c.scrollTop=c.scrollHeight;}
function scrollToMsg(id){const el=qs('#msg-'+id);if(el)el.scrollIntoView({behavior:'smooth',block:'center'});}

function setReply(msg){
  replyTo=msg;cancelEdit();
  const p=qs('#reply-preview');p.classList.remove('hidden');
  p.querySelector('.reply-text').textContent=`↩ ${msg.sender_name}: ${(msg.text||'').slice(0,60)}`;
}
function cancelReply(){replyTo=null;qs('#reply-preview').classList.add('hidden');}

function setEdit(msg){
  editingMsg=msg;cancelReply();
  const p=qs('#edit-preview');p.classList.remove('hidden');
  qs('#message-input').value=msg.text;qs('#message-input').focus();
}
function cancelEdit(){editingMsg=null;qs('#edit-preview').classList.add('hidden');qs('#message-input').value='';}

// Context menu
function showCtxMenu(e,msgId,text,isOut){
  e.preventDefault();
  ctxMsgData={id:msgId,text,isOut};
  const menu=qs('#msg-ctx-menu');
  qs('#ctx-edit-btn').style.display=isOut?'block':'none';
  qs('#ctx-delete-btn').style.display=isOut?'block':'none';
  const x=Math.min(e.clientX,window.innerWidth-180),y=Math.min(e.clientY,window.innerHeight-170);
  menu.style.left=x+'px';menu.style.top=y+'px';
  menu.classList.remove('hidden');
}
function ctxReply(){
  if (!ctxMsgData)return;
  setReply({id:ctxMsgData.id,text:ctxMsgData.text,sender_name:''});
  qs('#msg-ctx-menu').classList.add('hidden');
}
function ctxEdit(){
  if (!ctxMsgData||!ctxMsgData.isOut)return;
  setEdit({id:ctxMsgData.id,text:ctxMsgData.text});
  qs('#msg-ctx-menu').classList.add('hidden');
}
async function ctxDelete(){
  if (!ctxMsgData||!ctxMsgData.isOut||!currentChat)return;
  await api('DELETE',`/messages/${currentChat}/${ctxMsgData.id}`);
  qs('#msg-ctx-menu').classList.add('hidden');
}
function ctxCopy(){
  if (ctxMsgData?.text)navigator.clipboard?.writeText(ctxMsgData.text);
  qs('#msg-ctx-menu').classList.add('hidden');
  showToast('Скопировано ✓');
}

// ─── TYPING ───────────────────────────────────────────────────────────────────
function sendTyping(){
  if (!socket||!currentChat)return;
  socket.emit('typing',{room:currentChat,chat_id:currentChat,user_id:ME.id,name:ME.first_name});
  clearTimeout(typingTimerOut);
}
let typingEl=null,typingTimeout2=null;
function showTypingIndicator(name){
  const area=qs('#typing-area');
  if (!typingEl){
    typingEl=document.createElement('div');typingEl.className='message in';
    typingEl.style.marginTop='4px';
    typingEl.innerHTML=`<div style="font-size:11px;color:var(--text2);margin-bottom:2px">${esc(name)} печатает...</div>
      <div class="typing-indicator"><span></span><span></span><span></span></div>`;
    area.appendChild(typingEl);scrollToBottom();
  }
  clearTimeout(typingTimeout2);
  typingTimeout2=setTimeout(()=>{typingEl?.remove();typingEl=null;},3000);
}

// ─── FILE UPLOAD ──────────────────────────────────────────────────────────────
function triggerFileInput(){
  qs('#file-input-any').click();
}

async function handleFileUpload(input){
  const file=input.files[0];
  if (!file||!currentChat){input.value='';return;}
  if (file.size>100*1024*1024){showToast('❌ Файл слишком большой (макс 100MB)');input.value='';return;}

  const progress=qs('#upload-progress');
  const fill=qs('#upload-fill');
  const label=qs('#upload-label');
  progress.classList.remove('hidden');
  label.textContent=`Загрузка: ${file.name.slice(0,28)}`;

  try{
    const result=await uploadFile(file,pct=>{fill.style.width=pct+'%';});
    if (result.error){showToast('❌ '+result.error);return;}
    const body={text:'',attachment:{
      url:result.url,type:result.type,filename:result.filename,
      size_fmt:result.size_fmt,ext:result.ext,
      meta:result.meta||null, verified:result.verified,
    }};
    if (replyTo){body.reply_to={id:replyTo.id,text:replyTo.text,sender_name:replyTo.sender_name};cancelReply();}
    await api('POST',`/messages/${currentChat}`,body);
    loadChats();
    showToast('✅ Файл отправлен');
  }catch(e){showToast('❌ Ошибка загрузки');}
  finally{progress.classList.add('hidden');fill.style.width='0%';input.value='';}
}

function openMedia(url,type){
  const w=window.open('','_blank');
  if (type==='image')w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`);
}

// ─── VOICE MESSAGES ───────────────────────────────────────────────────────────
async function startVoice(e){
  if (e)e.preventDefault();
  if (isRecording||!currentChat)return;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    voiceChunks=[];
    const mimeType=MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'audio/ogg';
    mediaRec=new MediaRecorder(stream,{mimeType});
    mediaRec.ondataavailable=ev=>{if(ev.data.size>0)voiceChunks.push(ev.data);};
    mediaRec.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(voiceChunks,{type:mimeType});
      if (blob.size<1000)return;
      const file=new File([blob],'voice.webm',{type:mimeType});
      const result=await uploadFile(file);
      if (!result.error){
        const dur=voiceSeconds;
        const body={text:'',voice:result.url,voice_dur:formatVoiceDur(dur),attachment:null};
        await api('POST',`/messages/${currentChat}`,body);
        loadChats();
      }
    };
    mediaRec.start();
    isRecording=true;
    const btn=qs('#voice-btn');btn.classList.add('recording');btn.textContent='⏹';
    voiceSeconds=0;
    voiceTimer=setInterval(()=>{voiceSeconds++;btn.title=formatVoiceDur(voiceSeconds);},1000);
  }catch(e){showToast('❌ Нет доступа к микрофону');}
}

function stopVoice(e){
  if (e)e.preventDefault();
  if (!isRecording)return;
  isRecording=false;
  clearInterval(voiceTimer);
  if (mediaRec&&mediaRec.state!=='inactive')mediaRec.stop();
  const btn=qs('#voice-btn');btn.classList.remove('recording');btn.textContent='🎤';btn.title='Голосовое сообщение';
}

function playVoice(btn,url){
  const audio=new Audio(url);
  btn.textContent='⏸';
  audio.play();
  audio.onended=()=>{btn.textContent='▶';};
  audio.onerror=()=>{btn.textContent='▶';showToast('❌ Ошибка воспроизведения');};
}

// ─── USER SEARCH ──────────────────────────────────────────────────────────────
let _searchTimer=null;
async function searchUsers(q){
  clearTimeout(_searchTimer);
  if (!q.trim()){qs('#user-search-results').innerHTML='';return;}
  _searchTimer=setTimeout(async()=>{
    const users=await api('GET',`/users/search?q=${encodeURIComponent(q)}`);
    const res=qs('#user-search-results');
    if (!Array.isArray(users)||!users.length){
      res.innerHTML='<div style="padding:12px;color:var(--text2);text-align:center;font-size:13px">Не найдено</div>';
      return;
    }
    res.innerHTML=users.map(u=>{
      const cid=[ME.id,u.id].sort().join('_');
      const inC=ME.contacts?.includes(u.id);
      // FIX: Moved contact button logic out of inline template literal to avoid nesting issues
      const contactBtnStyle=inC?'background:var(--bg4);color:var(--text)':'';
      const contactBtnAction=inC?`removeContact('${u.id}')`:`addContact('${u.id}')`;
      const contactBtnLabel=inC?'✓ Контакт':'+ Контакт';
      const avStyle=u.avatar?`width:38px;height:38px;font-size:14px;background-image:url('${escAttr(u.avatar)}');background-size:cover;background-position:center`:'width:38px;height:38px;font-size:14px';
      return `<div class="result-item">
        <div class="chat-avatar" style="${avStyle}">${avatarInner(u.avatar,u.first_name[0])}</div>
        <div class="result-info">
          <div class="result-name">${esc(u.first_name)} ${esc(u.last_name)}</div>
          <div class="result-sub">@${u.username} · #${u.number}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn-sm" onclick="startDM('${cid}','${escAttr(u.first_name+' '+u.last_name)}','${u.id}')">💬</button>
          <button class="btn-sm" style="${contactBtnStyle}" onclick="${contactBtnAction}">${contactBtnLabel}</button>
        </div>
      </div>`;
    }).join('');
  },400);
}

function startDM(chatId,name,otherId){closeModal('new-chat-modal');openChat(chatId,'dm',name,otherId);}

// ── QR CONTACT ADDING ─────────────────────────────────────────────────────
// QR payload format: "pulse:contact:<user_id>" — deliberately just an id
// reference, never a token/secret, so scanning someone's code can only ever
// let others add *you* as a contact, nothing more sensitive.
function openMyQr(){
  openModal('qr-modal');
  const holder=qs('#qr-canvas-holder');
  holder.innerHTML='';
  new QRCode(holder,{text:`pulse:contact:${ME.id}`,width:220,height:220,colorDark:'#000',colorLight:'#fff'});
  qs('#qr-my-handle').textContent=`@${ME.username} · #${ME.number}`;
}

let _qrScanStream=null,_qrScanRAF=null;
async function startQrScan(){
  openModal('qr-scan-modal');
  const video=qs('#qr-scan-video'),status=qs('#qr-scan-status');
  status.textContent='Наведите камеру на QR-код';
  try{
    _qrScanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  }catch(e){
    status.textContent='❌ Нет доступа к камере: '+e.message;
    return;
  }
  video.srcObject=_qrScanStream;
  await video.play();
  const canvas=qs('#qr-scan-canvas'),ctx=canvas.getContext('2d');
  const tick=()=>{
    if(!_qrScanStream)return;
    if(video.readyState===video.HAVE_ENOUGH_DATA){
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const img=ctx.getImageData(0,0,canvas.width,canvas.height);
      const code=jsQR(img.data,img.width,img.height);
      if(code&&code.data){
        handleScannedQr(code.data);
        return;
      }
    }
    _qrScanRAF=requestAnimationFrame(tick);
  };
  _qrScanRAF=requestAnimationFrame(tick);
}
function stopQrScan(){
  closeModal('qr-scan-modal');
  if(_qrScanRAF)cancelAnimationFrame(_qrScanRAF);
  _qrScanRAF=null;
  if(_qrScanStream){_qrScanStream.getTracks().forEach(t=>t.stop());_qrScanStream=null;}
}
async function handleScannedQr(text){
  const m=/^pulse:contact:(.+)$/.exec(text.trim());
  stopQrScan();
  if(!m){showToast('❌ Это не QR-код контакта Pulse');return;}
  const uid=m[1];
  if(uid===ME.id){showToast('Это ваш собственный QR-код 🙂');return;}
  try{
    const u=await api('GET',`/users/${uid}`);
    await addContact(uid);
    const cid=[ME.id,uid].sort().join('_');
    closeModal('new-chat-modal');
    startDM(cid,`${u.first_name} ${u.last_name}`,uid);
  }catch(e){
    showToast('❌ Пользователь не найден');
  }
}

// FIX: These functions are now standalone and not called from inline template literals
async function addContact(uid){
  await api('POST','/contacts/add',{user_id:uid});
  const d=await api('GET','/me');ME=d;
  showToast('Контакт добавлен ✓');
  // Re-render search if open
  const q=val('user-search-input');
  if (q)searchUsers(q);
}
async function removeContact(uid){
  await api('POST','/contacts/remove',{user_id:uid});
  const d=await api('GET','/me');ME=d;
  showToast('Контакт удалён');
  const q=val('user-search-input');
  if (q)searchUsers(q);
}

// ─── GROUPS ───────────────────────────────────────────────────────────────────
selectedMembers=[];
async function searchUsersForGroup(q){
  if (!q.trim()){qs('#group-member-results').innerHTML='';return;}
  const users=await api('GET',`/users/search?q=${encodeURIComponent(q)}`);
  if (!Array.isArray(users))return;
  const res=qs('#group-member-results');
  res.innerHTML=users.filter(u=>!selectedMembers.find(m=>m.id===u.id)).map(u=>
    `<div class="result-item" onclick="addMemberSel('${u.id}','${escAttr(u.first_name+' '+u.last_name)}')">
      <div class="chat-avatar group-avatar" style="width:34px;height:34px;font-size:13px">${u.first_name[0]}</div>
      <div class="result-info">
        <div class="result-name">${esc(u.first_name)} ${esc(u.last_name)}</div>
        <div class="result-sub">@${u.username}</div>
      </div>
    </div>`
  ).join('');
}
function addMemberSel(id,name){
  if (selectedMembers.find(m=>m.id===id))return;
  selectedMembers.push({id,name});
  qs('#group-member-search').value='';qs('#group-member-results').innerHTML='';
  renderSelectedMembers();
}
function removeMemberSel(id){
  selectedMembers=selectedMembers.filter(m=>m.id!==id);
  renderSelectedMembers();
}
function renderSelectedMembers(){
  qs('#selected-members').innerHTML=selectedMembers.map(m=>
    `<div class="member-chip">${esc(m.name)}<button onclick="removeMemberSel('${m.id}')">✕</button></div>`
  ).join('');
}

async function createGroup(){
  const name=val('group-name'),description=val('group-desc');
  if (!name){showToast('Введите название');return;}
  const d=await api('POST','/groups',{name,description,members:selectedMembers.map(m=>m.id)});
  if (d.error){showToast(d.error);return;}
  closeModal('new-chat-modal');selectedMembers=[];
  await loadChats();openChat(d.id,'group',d.name,'');showToast('Группа создана ✓');
}

// ─── CHANNELS ─────────────────────────────────────────────────────────────────
async function createChannel(){
  const name=val('channel-name'),description=val('channel-desc'),isPublic=qs('#channel-public').checked;
  if (!name){showToast('Введите название');return;}
  const d=await api('POST','/channels',{name,description,public:isPublic});
  if (d.error){showToast(d.error);return;}
  closeModal('new-chat-modal');await loadChats();openChat(d.id,'channel',d.name,'');showToast('Канал создан ✓');
}
async function openPublicChannels(){
  const channels=await api('GET','/channels/public');
  const list=qs('#pub-channels-list');
  if (!Array.isArray(channels)||!channels.length){
    list.innerHTML='<div style="padding:20px;text-align:center;color:var(--text2)">Нет публичных каналов</div>';
  }else{
    list.innerHTML=channels.map(c=>`<div class="result-item">
      <div class="chat-avatar channel-avatar" style="width:42px;height:42px">${c.name[0]}</div>
      <div class="result-info">
        <div class="result-name">${esc(c.name)}</div>
        <div class="result-sub">${c.subscribers?.length||0} подписчиков · ${esc(c.description||'')}</div>
      </div>
      <button class="btn-sm" onclick="subAndOpen('${c.id}','${escAttr(c.name)}')">Войти</button>
    </div>`).join('');
  }
  openModal('pub-channels-modal');
}
async function subAndOpen(cid,name){
  await api('POST',`/channels/${cid}/subscribe`);
  closeModal('pub-channels-modal');await loadChats();openChat(cid,'channel',name,'');
}

// ─── CHAT INFO ────────────────────────────────────────────────────────────────
async function openChatInfo(){
  if (!currentChat)return;
  const chat=allChats.find(c=>c.id===currentChat);
  if (!chat)return;
  qs('#chat-info-title').textContent=chat.name;
  const content=qs('#chat-info-content');
  if (chat.type==='dm'){
    const otherId=currentChat.split('_').find(id=>id!==ME.id);
    const user=await api('GET',`/users/${otherId}`);
    const inC=ME.contacts?.includes(otherId);
    const joinDate=user.created_at?new Date(user.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}):'';
    content.innerHTML=`<div style="text-align:center;margin-bottom:22px">
      <div class="info-avatar"${avatarAttr(user.avatar)}>${avatarInner(user.avatar,user.first_name[0])}</div>
      <div style="font-weight:700;font-size:17px">${esc(user.first_name)} ${esc(user.last_name)}</div>
      <div style="color:var(--text2);margin-top:2px">@${user.username}</div>
      <div class="profile-number" style="display:inline-block;margin:10px auto">#${user.number}</div>
      <div style="color:var(--text2);font-size:13px;margin-top:4px">${esc(user.status||'')}</div>
      ${joinDate?`<div style="color:var(--text3);font-size:11px;margin-top:6px">В Pulse с ${joinDate}</div>`:''}
    </div>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <button class="btn-primary" style="flex:1" onclick="startCall('audio')">📞 Позвонить</button>
      <button class="btn-primary" style="flex:1" onclick="startCall('video')">📹 Видео</button>
    </div>
    <button class="btn-primary ${inC?'btn-danger':''}" onclick="${inC?`removeContactInfo('${otherId}')`:`addContactInfo('${otherId}')`}">
      ${inC?'− Удалить из контактов':'+ Добавить в контакты'}
    </button>`;
  }else if (chat.type==='group'){
    const g=await api('GET',`/groups/${currentChat}/info`);
    if (!g||g.error)return;
    const gJoinDate=g.created_at?new Date(g.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}):'';
    const isOwner=g.owner===ME.id, isAdmin=(g.admins||[]).includes(ME.id);
    const roleLabel={owner:'👑 Владелец',admin:'⭐ Админ',member:''};
    const membersHtml=(g.member_details||[]).map(m=>`
      <div class="result-item">
        <div class="chat-avatar group-avatar" style="width:34px;height:34px;font-size:13px"${avatarAttr(m.avatar)}>${avatarInner(m.avatar,m.first_name[0])}</div>
        <div class="result-info">
          <div class="result-name">${esc(m.first_name)} ${esc(m.last_name)} ${m.id===ME.id?'(вы)':''}</div>
          <div class="result-sub">@${esc(m.username)} ${roleLabel[m.role]||''}</div>
        </div>
        ${isAdmin&&m.id!==ME.id&&m.role!=='owner'?`
          <div style="display:flex;gap:4px">
            ${isOwner&&m.role!=='admin'?`<button class="btn-sm" onclick="promoteGroupAdmin('${g.id}','${m.id}')">+ Админ</button>`:''}
            ${isOwner&&m.role==='admin'?`<button class="btn-sm" onclick="demoteGroupAdmin('${g.id}','${m.id}')">− Админ</button>`:''}
            ${(isOwner||m.role!=='admin')?`<button class="btn-sm btn-danger" onclick="kickGroupMember('${g.id}','${m.id}')">Убрать</button>`:''}
          </div>`:''}
      </div>`).join('');
    content.innerHTML=`<div style="text-align:center;margin-bottom:20px">
      <div class="info-avatar group-avatar"${avatarAttr(g.avatar)}>${avatarInner(g.avatar,g.name[0])}</div>
      <div style="font-weight:700;font-size:16px">${esc(g.name)}</div>
      ${g.description?`<div style="color:var(--text2);font-size:13px;margin-top:4px">${esc(g.description)}</div>`:''}
      <div style="color:var(--text2);font-size:13px;margin-top:4px">${g.members.length} участников</div>
      ${gJoinDate?`<div style="color:var(--text3);font-size:11px;margin-top:2px">Создана ${gJoinDate}</div>`:''}
    </div>
    ${isAdmin?`<button class="btn-primary" style="margin-bottom:10px" onclick="openAddPeople('group-members','${g.id}',${JSON.stringify(g.members)})">+ Добавить участника</button>`:''}
    <div style="max-height:260px;overflow-y:auto;margin-bottom:10px">${membersHtml}</div>
    ${isOwner
      ?`<button class="btn-primary btn-danger" onclick="deleteGroupConfirm('${g.id}')">Удалить группу</button>`
      :`<button class="btn-primary btn-danger" onclick="leaveGroup('${g.id}')">Покинуть группу</button>`}`;
  }else{
    const c=await api('GET',`/channels/${currentChat}/info`);
    if (!c||c.error)return;
    const cJoinDate=c.created_at?new Date(c.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}):'';
    const isOwner=c.owner===ME.id, isAdmin=(c.admins||[]).includes(ME.id);
    const adminsHtml=(c.admin_details||[]).map(m=>`
      <div class="result-item">
        <div class="chat-avatar channel-avatar" style="width:34px;height:34px;font-size:13px"${avatarAttr(m.avatar)}>${avatarInner(m.avatar,m.first_name[0])}</div>
        <div class="result-info">
          <div class="result-name">${esc(m.first_name)} ${esc(m.last_name)} ${m.id===ME.id?'(вы)':''}</div>
          <div class="result-sub">@${esc(m.username)} ${m.role==='owner'?'👑 Владелец':'⭐ Админ'}</div>
        </div>
        ${isOwner&&m.role!=='owner'?`<button class="btn-sm btn-danger" onclick="removeChannelAdmin('${c.id}','${m.id}')">− Админ</button>`:''}
      </div>`).join('');
    content.innerHTML=`<div style="text-align:center;margin-bottom:20px">
      <div class="info-avatar channel-avatar"${avatarAttr(c.avatar)}>${avatarInner(c.avatar,c.name[0])}</div>
      <div style="font-weight:700;font-size:16px">${esc(c.name)}</div>
      ${c.description?`<div style="color:var(--text2);font-size:13px;margin-top:4px">${esc(c.description)}</div>`:''}
      <div style="color:var(--text2);font-size:13px;margin-top:4px">${c.subscribers?.length||0} подписчиков</div>
      <div style="color:var(--text2);font-size:12px;margin-top:4px">${c.public?'🌐 Публичный':'🔒 Приватный'}</div>
      ${cJoinDate?`<div style="color:var(--text3);font-size:11px;margin-top:2px">Создан ${cJoinDate}</div>`:''}
    </div>
    <div style="font-weight:600;font-size:13px;color:var(--text2);margin-bottom:6px">Администраторы</div>
    <div style="margin-bottom:10px">${adminsHtml}</div>
    ${isOwner?`<button class="btn-primary" style="margin-bottom:10px" onclick="openAddPeople('channel-admins','${c.id}',${JSON.stringify(c.admins||[])})">+ Добавить админа</button>`:''}
    ${isAdmin?`<button class="btn-primary" style="margin-bottom:10px;background:var(--bg4);color:var(--text)" onclick="openAddPeople('channel-subscribers','${c.id}',${JSON.stringify(c.subscribers||[])})">+ Добавить подписчика</button>`:''}
    ${isOwner
      ?`<button class="btn-primary btn-danger" onclick="deleteChannelConfirm('${c.id}')">Удалить канал</button>`
      :`<button class="btn-primary btn-danger" onclick="unsubscribeChannel('${c.id}')">Отписаться</button>`}`;
  }
  openModal('chat-info-modal');
}
async function leaveGroup(gid){
  const r=await api('POST',`/groups/${gid}/leave`);
  if (r&&r.error){showToast(r.error);return;}
  closeModal('chat-info-modal');closeChat();await loadChats();showToast('Вы покинули группу');
}
async function deleteGroupConfirm(gid){
  if (!confirm('Удалить группу навсегда? Это действие необратимо.'))return;
  await api('DELETE',`/groups/${gid}`);
  closeModal('chat-info-modal');closeChat();await loadChats();showToast('Группа удалена');
}
async function kickGroupMember(gid,uid){
  const r=await api('DELETE',`/groups/${gid}/members/${uid}`);
  if (r&&r.error){showToast(r.error);return;}
  openChatInfo();showToast('Участник удалён');
}
async function promoteGroupAdmin(gid,uid){
  const r=await api('POST',`/groups/${gid}/admins/${uid}`);
  if (r&&r.error){showToast(r.error);return;}
  openChatInfo();showToast('Назначен администратором');
}
async function demoteGroupAdmin(gid,uid){
  const r=await api('DELETE',`/groups/${gid}/admins/${uid}`);
  if (r&&r.error){showToast(r.error);return;}
  openChatInfo();showToast('Права администратора сняты');
}
async function unsubscribeChannel(cid){
  const r=await api('DELETE',`/channels/${cid}/subscribe`);
  if (r&&r.error){showToast(r.error);return;}
  closeModal('chat-info-modal');closeChat();await loadChats();showToast('Вы отписались от канала');
}
async function deleteChannelConfirm(cid){
  if (!confirm('Удалить канал навсегда? Это действие необратимо.'))return;
  await api('DELETE',`/channels/${cid}`);
  closeModal('chat-info-modal');closeChat();await loadChats();showToast('Канал удалён');
}
async function removeChannelAdmin(cid,uid){
  const r=await api('DELETE',`/channels/${cid}/admins/${uid}`);
  if (r&&r.error){showToast(r.error);return;}
  openChatInfo();showToast('Права администратора сняты');
}
async function addContactInfo(uid){await addContact(uid);openChatInfo();}
async function removeContactInfo(uid){await removeContact(uid);openChatInfo();}

// ─── ADD PEOPLE (generic modal: group members / channel admins / channel subscribers) ───
let addPeopleMode=null, addPeopleTarget=null, addPeopleExclude=[], addPeopleSelected=[];
const ADD_PEOPLE_TITLES={
  'group-members':'Добавить участника',
  'channel-admins':'Добавить администратора',
  'channel-subscribers':'Добавить подписчика',
};
function openAddPeople(mode,targetId,excludeIds){
  addPeopleMode=mode;addPeopleTarget=targetId;addPeopleExclude=excludeIds||[];addPeopleSelected=[];
  qs('#add-people-title').textContent=ADD_PEOPLE_TITLES[mode]||'Добавить';
  qs('#add-people-search').value='';qs('#add-people-results').innerHTML='';
  renderAddPeopleSelected();
  openModal('add-people-modal');
}
async function searchAddPeople(q){
  if (!q.trim()){qs('#add-people-results').innerHTML='';return;}
  const users=await api('GET',`/users/search?q=${encodeURIComponent(q)}`);
  if (!Array.isArray(users))return;
  const res=qs('#add-people-results');
  res.innerHTML=users
    .filter(u=>!addPeopleExclude.includes(u.id)&&!addPeopleSelected.find(m=>m.id===u.id))
    .map(u=>`<div class="result-item" onclick="addPeopleSel('${u.id}','${escAttr(u.first_name+' '+u.last_name)}')">
      <div class="chat-avatar group-avatar" style="width:34px;height:34px;font-size:13px">${u.first_name[0]}</div>
      <div class="result-info">
        <div class="result-name">${esc(u.first_name)} ${esc(u.last_name)}</div>
        <div class="result-sub">@${u.username}</div>
      </div>
    </div>`).join('');
}
function addPeopleSel(id,name){
  if (addPeopleSelected.find(m=>m.id===id))return;
  addPeopleSelected.push({id,name});
  qs('#add-people-search').value='';qs('#add-people-results').innerHTML='';
  renderAddPeopleSelected();
}
function removeAddPeopleSel(id){
  addPeopleSelected=addPeopleSelected.filter(m=>m.id!==id);
  renderAddPeopleSelected();
}
function renderAddPeopleSelected(){
  qs('#add-people-selected').innerHTML=addPeopleSelected.map(m=>
    `<div class="member-chip">${esc(m.name)}<button onclick="removeAddPeopleSel('${m.id}')">✕</button></div>`
  ).join('');
}
async function confirmAddPeople(){
  if (!addPeopleSelected.length){showToast('Выберите хотя бы одного пользователя');return;}
  const user_ids=addPeopleSelected.map(m=>m.id);
  let r;
  if (addPeopleMode==='group-members'){
    r=await api('POST',`/groups/${addPeopleTarget}/members`,{user_ids});
  }else if (addPeopleMode==='channel-admins'){
    for (const uid of user_ids) r=await api('POST',`/channels/${addPeopleTarget}/admins/${uid}`);
  }else if (addPeopleMode==='channel-subscribers'){
    r=await api('POST',`/channels/${addPeopleTarget}/subscribers`,{user_ids});
  }
  if (r&&r.error){showToast(r.error);return;}
  closeModal('add-people-modal');
  showToast('Добавлено ✓');
  openChatInfo();
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function loadProfileModal(){
  qs('#profile-firstname').value=ME.first_name;
  qs('#profile-lastname').value=ME.last_name;
  qs('#profile-status').value=ME.status||'';
  const avEl=qs('#profile-avatar-display');
  avEl.style.backgroundImage=ME.avatar?`url('${ME.avatar}')`:'';
  avEl.style.backgroundSize='cover';avEl.style.backgroundPosition='center';
  avEl.textContent=ME.avatar?'':ME.first_name[0].toUpperCase();
  qs('#profile-number-display').textContent='#'+ME.number+' · @'+ME.username;
  const joinDate=ME.created_at?new Date(ME.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}):'';
  let joinEl=qs('#profile-join-date');
  if(!joinEl){
    joinEl=document.createElement('div');
    joinEl.id='profile-join-date';
    joinEl.style.cssText='text-align:center;color:var(--text3);font-size:11px;margin-top:-14px;margin-bottom:16px';
    qs('#profile-number-display').insertAdjacentElement('afterend',joinEl);
  }
  joinEl.textContent=joinDate?`В Pulse с ${joinDate}`:'';
}
async function pickAvatarFile(){qs('#profile-avatar-input').click();}
async function onAvatarFileChosen(input){
  const file=input.files[0];
  if(!file)return;
  const fd=new FormData();fd.append('avatar',file);
  try{
    const res=await fetch('/api/me/avatar',{method:'POST',headers:{'Authorization':'Bearer '+TOKEN},body:fd});
    const d=await res.json();
    if(d.avatar){ME.avatar=d.avatar;loadProfileModal();showToast('Фото обновлено ✓');loadChats();}
    else showToast('❌ '+(d.error||'Не удалось загрузить фото'));
  }catch(e){showToast('❌ Ошибка загрузки фото');}
  input.value='';
}
async function saveProfile(){
  const d=await api('POST','/me/update',{
    first_name:val('profile-firstname'),
    last_name:val('profile-lastname'),
    status:val('profile-status')
  });
  ME=d;showToast('Сохранено ✓');closeModal('profile-modal');
}

// ─── BOTS ─────────────────────────────────────────────────────────────────────
async function openBotManager(){
  const bots=await api('GET','/bots');
  qs('#bot-list').innerHTML=!Array.isArray(bots)||!bots.length
    ?'<div style="color:var(--text2);text-align:center;padding:14px">Нет ботов</div>'
    :bots.map(b=>`<div class="bot-item">
      <div class="chat-avatar bot-avatar" style="width:38px;height:38px;font-size:16px">🤖</div>
      <div class="bot-item-info">
        <div class="bot-item-name">${esc(b.name)}</div>
        <div class="bot-token">${b.token}</div>
      </div>
      <button class="btn-sm" onclick="navigator.clipboard?.writeText('${b.token}');showToast('Токен скопирован ✓')">📋</button>
    </div>`).join('');
  openModal('bot-modal');
}
async function createBot(){
  const name=val('bot-name'),description=val('bot-desc');
  if (!name){showToast('Введите имя');return;}
  const d=await api('POST','/bots',{name,description});
  if (d.error){showToast(d.error);return;}
  qs('#bot-name').value='';qs('#bot-desc').value='';
  navigator.clipboard?.writeText(d.token);
  showToast('Бот создан ✓ Токен скопирован');
  openBotManager();
}

// ─── WEBRTC CALLS ─────────────────────────────────────────────────────────────
async function startCall(type){
  if (!currentOtherId&&currentChatType==='dm'){
    currentOtherId=currentChat.split('_').find(id=>id!==ME.id);
  }
  if (!currentOtherId){showToast('Выберите собеседника');return;}
  callType=type;callTargetUid=currentOtherId;

  try{
    const constraints={audio:true,video:type==='video'?{facingMode:'user'}:false};
    localStream=await navigator.mediaDevices.getUserMedia(constraints);
  }catch(e){showToast('❌ Нет доступа к камере/микрофону');return;}

  showCallOverlay(false);
  qs('#call-name').textContent=qs('#chat-header-name').textContent;
  qs('#call-avatar').textContent=qs('#chat-header-name').textContent[0];
  qs('#call-status').textContent='Звоним...';

  if (type==='video'){
    const lv=qs('#local-video');lv.classList.remove('hidden');
    lv.srcObject=localStream;lv.play().catch(()=>{});
  }

  peerConn=createPeerConn();
  localStream.getTracks().forEach(t=>peerConn.addTrack(t,localStream));
  const offer=await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  socket.emit('call_offer',{to_uid:callTargetUid,offer,call_type:type,caller_name:`${ME.first_name} ${ME.last_name}`,caller_id:ME.id});
}

function handleIncomingCall(data){
  incomingCallData=data;callType=data.call_type;callTargetUid=data.caller_id;
  showCallOverlay(true);
  qs('#call-name').textContent=data.caller_name||'Звонок';
  qs('#call-avatar').textContent=(data.caller_name||'?')[0];
  qs('#call-status').textContent=data.call_type==='video'?'📹 Входящий видеозвонок':'📞 Входящий звонок';
}

async function acceptCall(){
  if (!incomingCallData)return;
  qs('#call-incoming-actions').classList.add('hidden');
  qs('#call-status').textContent='Соединение...';
  try{
    const constraints={audio:true,video:callType==='video'?{facingMode:'user'}:false};
    localStream=await navigator.mediaDevices.getUserMedia(constraints);
  }catch(e){showToast('❌ Нет доступа к камере/микрофону');rejectCall();return;}
  if (callType==='video'){const lv=qs('#local-video');lv.classList.remove('hidden');lv.srcObject=localStream;lv.play().catch(()=>{});}
  peerConn=createPeerConn();
  localStream.getTracks().forEach(t=>peerConn.addTrack(t,localStream));
  await peerConn.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
  const answer=await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  socket.emit('call_answer',{to_uid:callTargetUid,answer});
}

async function handleCallAnswered(data){
  if (!peerConn)return;
  await peerConn.setRemoteDescription(new RTCSessionDescription(data.answer));
  qs('#call-status').textContent='Соединено';
  startCallTimer();
}

function rejectCall(){socket.emit('call_reject',{to_uid:callTargetUid});hideCallOverlay();incomingCallData=null;}
function endCall(){if(callTargetUid)socket.emit('call_end',{to_uid:callTargetUid});cleanupCall();hideCallOverlay();}

function cleanupCall(){
  if (peerConn){peerConn.close();peerConn=null;}
  if (localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  clearInterval(callTimerInterval);callSeconds=0;
  qs('#call-timer').classList.add('hidden');qs('#call-timer').textContent='00:00';
  qs('#remote-video').classList.add('hidden');qs('#local-video').classList.add('hidden');
  qs('#call-incoming-actions').classList.add('hidden');
  isMuted=false;isCamOff=false;
  qs('#mute-btn').classList.remove('active');qs('#cam-btn').classList.remove('active');
  qs('#mute-btn').textContent='🎤';qs('#cam-btn').textContent='📹';
  incomingCallData=null;
}

function createPeerConn(){
  const pc=new RTCPeerConnection(ICE_SERVERS);
  pc.onicecandidate=e=>{if(e.candidate)socket.emit('ice_candidate',{to_uid:callTargetUid,candidate:e.candidate});};
  pc.ontrack=e=>{
    remoteStream=e.streams[0];
    const rv=qs('#remote-video');rv.srcObject=remoteStream;rv.classList.remove('hidden');rv.play().catch(()=>{});
  };
  pc.onconnectionstatechange=()=>{
    if (['disconnected','failed','closed'].includes(pc.connectionState)){cleanupCall();hideCallOverlay();}
  };
  return pc;
}

function startCallTimer(){
  qs('#call-timer').classList.remove('hidden');
  callTimerInterval=setInterval(()=>{
    callSeconds++;
    const m=Math.floor(callSeconds/60),s=callSeconds%60;
    qs('#call-timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  },1000);
}

function showCallOverlay(incoming){
  qs('#call-overlay').classList.remove('hidden');
  qs('#call-incoming-actions').classList.toggle('hidden',!incoming);
  qs('.call-actions').classList.toggle('hidden',incoming);
}
function hideCallOverlay(){qs('#call-overlay').classList.add('hidden');}

function toggleMute(){
  isMuted=!isMuted;
  localStream?.getAudioTracks().forEach(t=>t.enabled=!isMuted);
  qs('#mute-btn').classList.toggle('active',isMuted);
  qs('#mute-btn').textContent=isMuted?'🔇':'🎤';
}
function toggleCamera(){
  isCamOff=!isCamOff;
  localStream?.getVideoTracks().forEach(t=>t.enabled=!isCamOff);
  qs('#cam-btn').classList.toggle('active',isCamOff);
  qs('#cam-btn').textContent=isCamOff?'🚫':'📹';
}

// ─── P2P FILE TRANSFER (WebRTC DataChannel, direct user-to-user) ───────────────
// The file's bytes travel only over the DataChannel between the two browsers —
// the server only relays the WebRTC signaling (SDP offer/answer + ICE), the
// same way it already does for voice/video calls. The server never stores or
// even sees the file's content.

function triggerP2PFileInput(){
  if (!currentOtherId||currentChatType!=='dm'){showToast('P2P-передача доступна только в личных чатах');return;}
  const chat=allChats.find(c=>c.id===currentChat);
  if (!chat?.online){showToast('❌ Собеседник не в сети — P2P-передача невозможна');return;}
  qs('#file-input-p2p').click();
}

function handleP2PFileSelect(input){
  const file=input.files[0];
  input.value='';
  if (!file||!currentOtherId)return;
  startP2PFileSend(file);
}

async function startP2PFileSend(file){
  const transferId=crypto.randomUUID?crypto.randomUUID():(''+Date.now()+Math.random());
  p2pTransfer={id:transferId,direction:'send',file,filename:file.name,size:file.size,mime:file.type,toUid:currentOtherId};

  filePeerConn=new RTCPeerConnection(ICE_SERVERS);
  filePeerConn.onicecandidate=e=>{
    if (e.candidate)socket.emit('p2p_file_ice',{to_uid:currentOtherId,candidate:e.candidate,transfer_id:transferId});
  };
  filePeerConn.onconnectionstatechange=()=>{
    if (['failed','closed'].includes(filePeerConn.connectionState)&&p2pTransfer)showToast('❌ P2P-соединение прервано');
  };
  fileDataChannel=filePeerConn.createDataChannel('file',{ordered:true});
  fileDataChannel.binaryType='arraybuffer';
  fileDataChannel.onopen=()=>sendFileOverChannel(file);
  fileDataChannel.onerror=()=>{showToast('❌ Ошибка P2P-канала');cleanupP2PTransfer();};

  const offer=await filePeerConn.createOffer();
  await filePeerConn.setLocalDescription(offer);

  showP2PPanel('send',file.name,'Ожидание ответа собеседника…');
  qs('#p2p-transfer-actions').innerHTML=`<button class="btn-secondary" onclick="cancelP2PTransfer()">Отменить</button>`;

  socket.emit('p2p_file_offer',{
    to_uid:currentOtherId, transfer_id:transferId, offer,
    filename:file.name, size:file.size, mime:file.type,
    from_name:`${ME.first_name} ${ME.last_name}`, from_id:ME.id,
  });
}

function sendFileOverChannel(file){
  qs('#p2p-transfer-status').textContent='Передача…';
  qs('#p2p-transfer-actions').innerHTML=`<button class="btn-secondary" onclick="cancelP2PTransfer()">Отменить</button>`;
  let offset=0;
  const reader=new FileReader();
  fileDataChannel.bufferedAmountLowThreshold=P2P_BUFFER_THRESHOLD/2;

  function sendNextChunk(){
    if (!fileDataChannel||fileDataChannel.readyState!=='open')return;
    if (offset>=file.size){
      fileDataChannel.send(JSON.stringify({__p2p_done:true}));
      qs('#p2p-transfer-fill').style.width='100%';
      qs('#p2p-transfer-status').textContent='✅ Отправлено';
      finalizeP2PSend();
      return;
    }
    const slice=file.slice(offset,offset+P2P_CHUNK_SIZE);
    reader.onload=ev=>{
      fileDataChannel.send(ev.target.result);
      offset+=ev.target.result.byteLength;
      qs('#p2p-transfer-fill').style.width=Math.round(offset/file.size*100)+'%';
      if (fileDataChannel.bufferedAmount>P2P_BUFFER_THRESHOLD){
        fileDataChannel.onbufferedamountlow=()=>{fileDataChannel.onbufferedamountlow=null;sendNextChunk();};
      }else{
        sendNextChunk();
      }
    };
    reader.readAsArrayBuffer(slice);
  }
  sendNextChunk();
}

async function finalizeP2PSend(){
  if (!p2pTransfer)return;
  // Record a lightweight notice in chat history (metadata only — the file
  // itself was never uploaded to the server, true to "P2P").
  try{
    await api('POST',`/messages/${currentChat}`,{
      text:'', p2p_file:{filename:p2pTransfer.filename, size_fmt:fmtBytes(p2pTransfer.size)},
    });
    loadChats();
  }catch(e){}
  setTimeout(cleanupP2PTransfer,1500);
}

function handleP2PFileOfferIncoming(data){
  p2pTransfer={
    id:data.transfer_id, direction:'recv', filename:data.filename, size:data.size,
    mime:data.mime, toUid:data.from_id, offer:data.offer,
    receivedChunks:[], receivedBytes:0,
  };
  showP2PPanel('recv',data.filename,`${data.from_name||'Собеседник'} хочет передать файл (${fmtBytes(data.size)})`);
  qs('#p2p-transfer-actions').innerHTML=`
    <button class="btn-primary" onclick="acceptP2PFileTransfer()">✅ Принять</button>
    <button class="btn-secondary" onclick="rejectP2PFileTransfer()">✕ Отклонить</button>`;
}

async function acceptP2PFileTransfer(){
  if (!p2pTransfer)return;
  qs('#p2p-transfer-status').textContent='Соединение…';
  qs('#p2p-transfer-actions').innerHTML=`<button class="btn-secondary" onclick="cancelP2PTransfer()">Отменить</button>`;

  filePeerConn=new RTCPeerConnection(ICE_SERVERS);
  filePeerConn.onicecandidate=e=>{
    if (e.candidate)socket.emit('p2p_file_ice',{to_uid:p2pTransfer.toUid,candidate:e.candidate,transfer_id:p2pTransfer.id});
  };
  filePeerConn.ondatachannel=ev=>{
    fileDataChannel=ev.channel;
    fileDataChannel.binaryType='arraybuffer';
    fileDataChannel.onmessage=handleP2PChannelMessage;
  };
  await filePeerConn.setRemoteDescription(new RTCSessionDescription(p2pTransfer.offer));
  const answer=await filePeerConn.createAnswer();
  await filePeerConn.setLocalDescription(answer);
  socket.emit('p2p_file_answer',{to_uid:p2pTransfer.toUid,answer,transfer_id:p2pTransfer.id});
  qs('#p2p-transfer-status').textContent='Приём файла…';
}

function handleP2PChannelMessage(ev){
  if (!p2pTransfer)return;
  if (typeof ev.data==='string'){
    try{
      const msg=JSON.parse(ev.data);
      if (msg.__p2p_done){assembleReceivedFile();}
    }catch(e){}
    return;
  }
  p2pTransfer.receivedChunks.push(ev.data);
  p2pTransfer.receivedBytes+=ev.data.byteLength;
  const pct=Math.min(100,Math.round(p2pTransfer.receivedBytes/p2pTransfer.size*100));
  qs('#p2p-transfer-fill').style.width=pct+'%';
}

function assembleReceivedFile(){
  if (!p2pTransfer)return;
  const blob=new Blob(p2pTransfer.receivedChunks,{type:p2pTransfer.mime||'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  qs('#p2p-transfer-status').textContent='✅ Файл получен';
  qs('#p2p-transfer-actions').innerHTML=
    `<a class="btn-primary" href="${url}" download="${escAttr(p2pTransfer.filename)}">💾 Скачать</a>`;
  showToast('📡 Файл получен по P2P: '+p2pTransfer.filename);
  loadChats();
  // Keep the panel open with the download link until the user dismisses it
  // or opens another chat — the blob URL is only valid for this session,
  // which is an inherent limit of true P2P transfer (nothing is stored
  // server-side, so reloading the page loses access to the bytes).
  p2pTransfer.receivedChunks=[]; // free memory references after blob creation
}

function handleP2PFileAnswer(data){
  if (filePeerConn&&data.answer)filePeerConn.setRemoteDescription(new RTCSessionDescription(data.answer));
}

function rejectP2PFileTransfer(){
  if (p2pTransfer)socket.emit('p2p_file_reject',{to_uid:p2pTransfer.toUid,transfer_id:p2pTransfer.id});
  cleanupP2PTransfer();
}

function cancelP2PTransfer(){
  if (p2pTransfer)socket.emit('p2p_file_cancel',{to_uid:p2pTransfer.toUid,transfer_id:p2pTransfer.id});
  cleanupP2PTransfer();
}

function cleanupP2PTransfer(){
  if (fileDataChannel){try{fileDataChannel.close();}catch(e){} fileDataChannel=null;}
  if (filePeerConn){try{filePeerConn.close();}catch(e){} filePeerConn=null;}
  p2pTransfer=null;
  hideP2PPanel();
}

function showP2PPanel(dir,filename,status){
  qs('#p2p-transfer-panel').classList.remove('hidden');
  qs('#p2p-transfer-name').textContent=filename;
  qs('#p2p-transfer-status').textContent=status;
  qs('#p2p-transfer-fill').style.width='0%';
}
function hideP2PPanel(){
  qs('#p2p-transfer-panel').classList.add('hidden');
}
function fmtBytes(sz){
  for (const u of ['B','KB','MB','GB']){ if (sz<1024) return `${sz.toFixed(1)} ${u}`; sz/=1024; }
  return `${sz.toFixed(1)} GB`;
}

// ─── EMOJI ────────────────────────────────────────────────────────────────────
function setupEmojis(){
  qs('#emoji-grid').innerHTML=EMOJIS.map(e=>`<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}
function openEmojiPicker(){qs('#emoji-picker').classList.toggle('hidden');}
function insertEmoji(e){const i=qs('#message-input');i.value+=e;i.focus();qs('#emoji-picker').classList.add('hidden');}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function openModal(id){qs('#'+id).classList.remove('hidden');}
function closeModal(id){qs('#'+id).classList.add('hidden');}
function switchModalTab(modalId,tab){
  const modal=qs('#'+modalId);
  const tabs=['dm','group','channel'];
  modal.querySelectorAll('.mtab').forEach((t,i)=>t.classList.toggle('active',tabs[i]===tab));
  modal.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('hidden',el.dataset.tab!==tab));
}

// ─── PWA: installable app shell (mobile "app" = this same web app) ───────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
