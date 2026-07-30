from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
import json, os, uuid, hashlib, random, string, shutil, subprocess
from datetime import datetime
from functools import wraps
from werkzeug.utils import secure_filename

# ── optional file-inspection libraries ────────────────────────────────────────
# All wrapped in try/except so the app still runs (with reduced verification /
# metadata features) if one of them isn't installed in a given environment.
try:
    import filetype as _filetype          # magic-byte sniffing (pure python)
except ImportError:
    _filetype = None
try:
    from PIL import Image as _PILImage, ExifTags as _ExifTags
except ImportError:
    _PILImage = None
try:
    from pypdf import PdfReader as _PdfReader
except ImportError:
    _PdfReader = None
try:
    import mutagen as _mutagen
except ImportError:
    _mutagen = None

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = 'pulse-secret-key-change-in-production'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading',
                    max_http_buffer_size=100*1024*1024)

DATA_DIR     = 'data'
UPLOADS_DIR  = os.path.join('static', 'uploads')
AVATARS_DIR  = os.path.join('static', 'avatars')
USERS_FILE   = os.path.join(DATA_DIR, 'users.json')
GROUPS_FILE  = os.path.join(DATA_DIR, 'groups.json')
CHANNELS_FILE= os.path.join(DATA_DIR, 'channels.json')
BOTS_FILE    = os.path.join(DATA_DIR, 'bots.json')

ALLOWED = {
    'image': {'png','jpg','jpeg','gif','webp','bmp'},
    'video': {'mp4','webm','mov','avi','mkv'},
    'audio': {'mp3','ogg','wav','m4a','opus'},
    'file':  {'pdf','doc','docx','xls','xlsx','ppt','pptx','zip','rar','txt','csv'},
}
AVATAR_ALLOWED = {'png','jpg','jpeg','gif','webp'}

# ── i18n ──────────────────────────────────────────────────────────────────────
# Supported: ru, en, tr, ua
# Select via ?lang=<code>  OR  Accept-Language header
TRANSLATIONS = {
    'ru': {
        'all_fields_required':   'Все поля обязательны',
        'password_too_short':    'Пароль минимум 6 символов',
        'username_taken':        'Username уже занят',
        'wrong_credentials':     'Неверный логин или пароль',
        'file_type_unsupported': 'Тип файла не поддерживается',
        'avatar_type_invalid':   'Аватар должен быть изображением (png/jpg/jpeg/gif/webp)',
        'not_found':             'Не найдено',
        'forbidden':             'Доступ запрещён',
        'no_permission':         'Нет прав',
        'empty_message':         'Сообщение не может быть пустым',
        'name_required':         'Требуется название',
        'user_unavailable':      'Пользователь недоступен',
        'default_status':        'Привет, я использую Pulse!',
        'unauthorized':          'Не авторизован',
        'bot_not_yours':         'Этот бот вам не принадлежит',
        'command_required':      'Требуется название команды',
        'file_verification_failed': 'Содержимое файла не соответствует его типу (не прошло проверку)',
    },
    'en': {
        'all_fields_required':   'All fields are required',
        'password_too_short':    'Password must be at least 6 characters',
        'username_taken':        'Username is already taken',
        'wrong_credentials':     'Invalid username or password',
        'file_type_unsupported': 'File type is not supported',
        'avatar_type_invalid':   'Avatar must be an image (png/jpg/jpeg/gif/webp)',
        'not_found':             'Not found',
        'forbidden':             'Forbidden',
        'no_permission':         'Permission denied',
        'empty_message':         'Message cannot be empty',
        'name_required':         'Name is required',
        'user_unavailable':      'User is unavailable',
        'default_status':        'Hey, I am using Pulse!',
        'unauthorized':          'Unauthorized',
        'bot_not_yours':         'This bot does not belong to you',
        'command_required':      'Command name is required',
        'file_verification_failed': "File content does not match its declared type (failed verification)",
    },
    'tr': {
        'all_fields_required':   'Tüm alanlar zorunludur',
        'password_too_short':    'Şifre en az 6 karakter olmalıdır',
        'username_taken':        'Kullanıcı adı zaten alınmış',
        'wrong_credentials':     'Geçersiz kullanıcı adı veya şifre',
        'file_type_unsupported': 'Dosya türü desteklenmiyor',
        'avatar_type_invalid':   'Avatar bir resim olmalıdır (png/jpg/jpeg/gif/webp)',
        'not_found':             'Bulunamadı',
        'forbidden':             'Erişim engellendi',
        'no_permission':         'İzin yok',
        'empty_message':         'Mesaj boş olamaz',
        'name_required':         'Ad gereklidir',
        'user_unavailable':      'Kullanıcı mevcut değil',
        'default_status':        'Merhaba, Pulse kullanıyorum!',
        'unauthorized':          'Yetkisiz',
        'bot_not_yours':         'Bu bot size ait değil',
        'command_required':      'Komut adı gereklidir',
        'file_verification_failed': 'Dosya içeriği beyan edilen türüyle eşleşmiyor (doğrulama başarısız)',
    },
    'ua': {
        'all_fields_required':   "Усі поля обов'язкові",
        'password_too_short':    'Пароль має бути не менше 6 символів',
        'username_taken':        "Ім'я користувача вже зайнято",
        'wrong_credentials':     'Невірний логін або пароль',
        'file_type_unsupported': 'Тип файлу не підтримується',
        'avatar_type_invalid':   'Аватар має бути зображенням (png/jpg/jpeg/gif/webp)',
        'not_found':             'Не знайдено',
        'forbidden':             'Доступ заборонено',
        'no_permission':         'Немає прав',
        'empty_message':         'Повідомлення не може бути порожнім',
        'name_required':         "Назва обов'язкова",
        'user_unavailable':      'Користувач недоступний',
        'default_status':        'Привіт, я використовую Pulse!',
        'unauthorized':          'Не авторизовано',
        'bot_not_yours':         'Цей бот вам не належить',
        'command_required':      "Назва команди обов'язкова",
        'file_verification_failed': 'Вміст файлу не відповідає заявленому типу (перевірку не пройдено)',
    },
}
SUPPORTED_LANGS = set(TRANSLATIONS.keys())
DEFAULT_LANG    = 'ru'

def get_lang():
    """Priority: ?lang= param → Accept-Language header → DEFAULT_LANG."""
    lang = request.args.get('lang', '').strip().lower()
    if lang == 'uk': lang = 'ua'
    if lang in SUPPORTED_LANGS: return lang
    for part in request.headers.get('Accept-Language', '').replace(' ','').split(','):
        code = part.split(';')[0].split('-')[0].lower()
        if code == 'uk': code = 'ua'
        if code in SUPPORTED_LANGS: return code
    return DEFAULT_LANG

def t(key: str) -> str:
    lang = get_lang()
    return TRANSLATIONS.get(lang, TRANSLATIONS[DEFAULT_LANG]).get(key, key)

def err(key: str, status: int = 400):
    return jsonify({'error': t(key), 'key': key}), status

# ── data helpers ──────────────────────────────────────────────────────────────
def init_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, 'messages'), exist_ok=True)
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    os.makedirs(AVATARS_DIR, exist_ok=True)
    for ftype in ALLOWED:
        os.makedirs(os.path.join(UPLOADS_DIR, ftype), exist_ok=True)
    for f, d in [(USERS_FILE,{}),(GROUPS_FILE,{}),(CHANNELS_FILE,{}),(BOTS_FILE,{})]:
        if not os.path.exists(f): save_json(f, d)

def load_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f: return json.load(f)
    except: return {}

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_messages(chat_id):
    path = os.path.join(DATA_DIR, 'messages', secure_filename(chat_id) + '.json')
    if not os.path.exists(path): return []
    with open(path, 'r', encoding='utf-8') as f: return json.load(f)

def save_messages(chat_id, msgs):
    path = os.path.join(DATA_DIR, 'messages', secure_filename(chat_id) + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(msgs, f, ensure_ascii=False, indent=2)

def hash_pw(pw): return hashlib.sha256(pw.encode()).hexdigest()

def gen_number():
    users = load_json(USERS_FILE)
    existing = {u['number'] for u in users.values()}
    while True:
        n = ''.join(random.choices(string.digits, k=8))
        if n not in existing: return n

def auth_required(f):
    @wraps(f)
    def dec(*a, **kw):
        tok  = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not tok: return err('unauthorized', 401)
        users = load_json(USERS_FILE)
        user  = next((u for u in users.values() if u.get('token') == tok), None)
        if not user: return err('unauthorized', 401)
        return f(user, *a, **kw)
    return dec

def fmt_size(sz):
    for u in ['B','KB','MB','GB']:
        if sz < 1024: return f"{sz:.1f} {u}"
        sz /= 1024
    return f"{sz:.1f} GB"

def get_ftype(fname):
    ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
    for name, exts in ALLOWED.items():
        if ext in exts: return name, ext
    return None, ext

# ── file verification (magic-byte sniffing) ──────────────────────────────────
def verify_file_type(path, declared_ftype):
    """Inspect the file's actual content (signature/magic bytes), not just its
    extension, and compare it against the category the upload claimed to be.

    Returns (verified, real_ext):
      True   -> content signature matches the declared category
      False  -> content signature was detected but does NOT match
                 (caller should reject the upload)
      None   -> no known binary signature (e.g. plain text: .txt/.csv) —
                 nothing to check against, so it's allowed but unverified.
    """
    if _filetype is None:
        return None, None          # library unavailable -> skip verification
    try:
        kind = _filetype.guess(path)
    except Exception:
        kind = None
    if kind is None:
        return None, None
    real_ext = kind.extension
    real_ftype, _ = get_ftype('x.' + real_ext)
    if real_ftype is None:
        # We recognized *some* file signature, but it isn't a category we
        # allow at all (e.g. an executable renamed to look like an image).
        return False, real_ext
    return (real_ftype == declared_ftype), real_ext

# ── metadata extraction ───────────────────────────────────────────────────────
def _ffprobe_value(path, *args):
    if not shutil.which('ffprobe'):
        return None
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'error', *args, path],
            capture_output=True, text=True, timeout=15,
        )
        val = out.stdout.strip()
        return val or None
    except Exception:
        return None

def extract_metadata(path, ftype, ext):
    """Best-effort metadata extraction. Never raises — on any failure it just
    returns whatever fields it managed to collect (possibly an empty dict)."""
    meta = {}
    try:
        if ftype == 'image' and _PILImage is not None:
            with _PILImage.open(path) as im:
                meta['width'], meta['height'] = im.size
                meta['format'] = im.format
                try:
                    raw_exif = im._getexif()
                except Exception:
                    raw_exif = None
                if raw_exif:
                    exif_out = {}
                    for tag_id, value in raw_exif.items():
                        if isinstance(value, bytes):
                            continue
                        tag = _ExifTags.TAGS.get(tag_id, str(tag_id))
                        exif_out[str(tag)] = str(value)[:200]
                    if exif_out:
                        meta['exif'] = exif_out
                        meta['has_gps'] = 'GPSInfo' in exif_out

        elif ftype == 'file' and ext == 'pdf' and _PdfReader is not None:
            reader = _PdfReader(path)
            meta['pages'] = len(reader.pages)
            info = reader.metadata
            if info:
                if info.title:  meta['title']  = str(info.title)
                if info.author: meta['author'] = str(info.author)

        elif ftype in ('audio', 'video'):
            dur = _ffprobe_value(
                path, '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
            )
            duration = None
            if dur:
                try: duration = float(dur)
                except ValueError: duration = None
            if duration is None and ftype == 'audio' and _mutagen is not None:
                try:
                    f = _mutagen.File(path)
                    if f and f.info: duration = f.info.length
                except Exception:
                    pass
            if duration is not None:
                meta['duration_sec'] = round(duration, 1)
                m, s = divmod(int(duration), 60)
                meta['duration_fmt'] = f"{m}:{s:02d}"
            if ftype == 'video':
                res = _ffprobe_value(
                    path, '-select_streams', 'v:0',
                    '-show_entries', 'stream=width,height',
                    '-of', 'csv=p=0:s=x',
                )
                if res and 'x' in res:
                    try:
                        w, h = res.split('x')[:2]
                        meta['width'], meta['height'] = int(w), int(h)
                    except ValueError:
                        pass
    except Exception:
        pass
    return meta

def public_user(u):
    return {k: v for k, v in u.items() if k not in ('password', 'token')}

# ── AUTH ──────────────────────────────────────────────────────────────────────
@app.route('/api/register', methods=['POST'])
def register():
    d  = request.json or {}
    fn = d.get('first_name', '').strip()
    ln = d.get('last_name',  '').strip()
    un = d.get('username',   '').strip().lower()
    pw = d.get('password',   '')
    if not all([fn, ln, un, pw]): return err('all_fields_required')
    if len(pw) < 6: return err('password_too_short')
    users = load_json(USERS_FILE)
    if any(u['username'] == un for u in users.values()): return err('username_taken')
    uid  = str(uuid.uuid4()); tok = str(uuid.uuid4())
    lang = d.get('lang', get_lang())
    if lang not in SUPPORTED_LANGS: lang = DEFAULT_LANG
    users[uid] = {
        'id': uid, 'first_name': fn, 'last_name': ln, 'username': un,
        'number': gen_number(), 'password': hash_pw(pw), 'token': tok,
        'avatar': None, 'status': TRANSLATIONS[lang]['default_status'],
        'online': True, 'created_at': datetime.now().isoformat(),
        'contacts': [], 'theme': 'dark', 'lang': lang,
    }
    save_json(USERS_FILE, users)
    return jsonify({'user': public_user(users[uid]), 'token': tok})

@app.route('/api/login', methods=['POST'])
def login():
    d  = request.json or {}
    un = d.get('username', '').strip().lower()
    pw = d.get('password', '')
    users = load_json(USERS_FILE)
    user  = next((u for u in users.values() if u['username'] == un), None)
    if not user or user['password'] != hash_pw(pw): return err('wrong_credentials', 401)
    tok = str(uuid.uuid4())
    users[user['id']]['token']  = tok
    users[user['id']]['online'] = True
    save_json(USERS_FILE, users)
    return jsonify({'user': public_user(users[user['id']]), 'token': tok})

@app.route('/api/logout', methods=['POST'])
@auth_required
def logout(cu):
    users = load_json(USERS_FILE)
    users[cu['id']]['online'] = False
    users[cu['id']]['token']  = None
    save_json(USERS_FILE, users)
    return jsonify({'ok': True})

@app.route('/api/me', methods=['GET'])
@auth_required
def get_me(cu): return jsonify(public_user(cu))

@app.route('/api/me/update', methods=['POST'])
@auth_required
def update_me(cu):
    d     = request.json or {}
    users = load_json(USERS_FILE)
    for field in ('first_name', 'last_name', 'status', 'theme', 'lang'):
        if field in d:
            val = d[field]
            if field == 'lang' and val not in SUPPORTED_LANGS: continue
            users[cu['id']][field] = val
    save_json(USERS_FILE, users)
    return jsonify(public_user(users[cu['id']]))

# ── AVATAR ────────────────────────────────────────────────────────────────────
# POST /api/me/avatar
# Content-Type: multipart/form-data
# Field:  avatar  (image file)
# Returns: { "avatar": "/static/avatars/<filename>" }
@app.route('/api/me/avatar', methods=['POST'])
@auth_required
def upload_avatar(cu):
    if 'avatar' not in request.files:
        return err('file_type_unsupported')
    file = request.files['avatar']
    if not file.filename:
        return err('file_type_unsupported')
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in AVATAR_ALLOWED:
        return err('avatar_type_invalid')
    fname = f"{cu['id']}_{uuid.uuid4().hex}.{ext}"
    path  = os.path.join(AVATARS_DIR, fname)
    file.save(path)
    avatar_url = f"/static/avatars/{fname}"
    users = load_json(USERS_FILE)
    # Delete previous avatar file from disk
    old = users[cu['id']].get('avatar')
    if old:
        old_path = os.path.join('static', old.lstrip('/').removeprefix('static/'))
        if os.path.isfile(old_path):
            try: os.remove(old_path)
            except OSError: pass
    users[cu['id']]['avatar'] = avatar_url
    save_json(USERS_FILE, users)
    # Notify all clients (so avatar updates in chat lists instantly)
    socketio.emit('user_updated', {'uid': cu['id'], 'avatar': avatar_url})
    return jsonify({'avatar': avatar_url})

# ── USERS ─────────────────────────────────────────────────────────────────────
@app.route('/api/users/search')
@auth_required
def search_users(cu):
    q     = request.args.get('q', '').strip().lower()
    users = load_json(USERS_FILE)
    res   = [public_user(u) for u in users.values()
             if u['id'] != cu['id'] and (
                 q in u['username'] or q in u['number'] or
                 q in u['first_name'].lower() or q in u['last_name'].lower())]
    return jsonify(res[:20])

@app.route('/api/users/<uid>')
@auth_required
def get_user(cu, uid):
    users = load_json(USERS_FILE)
    u = users.get(uid)
    if not u: return err('not_found', 404)
    return jsonify(public_user(u))

@app.route('/api/contacts')
@auth_required
def get_contacts(cu):
    users = load_json(USERS_FILE)
    return jsonify([public_user(users[c]) for c in cu.get('contacts', []) if c in users])

@app.route('/api/contacts/add', methods=['POST'])
@auth_required
def add_contact(cu):
    tid   = (request.json or {}).get('user_id')
    users = load_json(USERS_FILE)
    if tid not in users: return err('not_found', 404)
    if tid not in users[cu['id']]['contacts']:
        users[cu['id']]['contacts'].append(tid)
        save_json(USERS_FILE, users)
        # Live-refresh: tell the other side (if online) that someone added them,
        # so their contact/chat list updates instantly without a page reload.
        target_sid = user_sockets.get(tid)
        if target_sid:
            socketio.emit('contact_added', {'by': public_user(cu)}, room=target_sid)
    return jsonify({'ok': True})

@app.route('/api/contacts/remove', methods=['POST'])
@auth_required
def remove_contact(cu):
    tid   = (request.json or {}).get('user_id')
    users = load_json(USERS_FILE)
    users[cu['id']]['contacts'] = [c for c in users[cu['id']]['contacts'] if c != tid]
    save_json(USERS_FILE, users)
    return jsonify({'ok': True})

# ── FILE UPLOAD ───────────────────────────────────────────────────────────────
@app.route('/api/upload', methods=['POST'])
@auth_required
def upload_file(cu):
    if 'file' not in request.files: return err('file_type_unsupported')
    file = request.files['file']
    if not file.filename: return err('file_type_unsupported')
    ftype, ext = get_ftype(file.filename)
    if not ftype: return err('file_type_unsupported')
    fname = f"{uuid.uuid4().hex}.{ext}"
    path  = os.path.join(UPLOADS_DIR, ftype, fname)
    file.save(path)

    # Verify the file's actual content (magic bytes) matches its declared
    # type/extension — catches e.g. a renamed .exe pretending to be a .jpg.
    verified, real_ext = verify_file_type(path, ftype)
    if verified is False:
        try: os.remove(path)
        except OSError: pass
        return err('file_verification_failed')

    sz   = os.path.getsize(path)
    meta = extract_metadata(path, ftype, ext)
    return jsonify({
        'url': f"/static/uploads/{ftype}/{fname}", 'type': ftype,
        'filename': file.filename, 'size': sz, 'size_fmt': fmt_size(sz), 'ext': ext,
        'verified': verified,      # True / False(never reaches here) / None = unverifiable (e.g. .txt)
        'real_ext': real_ext,      # extension detected from content, if any
        'meta': meta,              # dimensions / EXIF / page count / duration, depending on type
    })

# ── MESSAGES ──────────────────────────────────────────────────────────────────
@app.route('/api/messages/<chat_id>')
@auth_required
def get_messages(cu, chat_id):
    parts = chat_id.split('_')
    if not chat_id.startswith('group_') and not chat_id.startswith('ch_'):
        if cu['id'] not in parts: return err('forbidden', 403)
    msgs   = load_messages(chat_id)
    offset = int(request.args.get('offset', 0))
    limit  = int(request.args.get('limit', 50))
    total  = len(msgs)
    page   = msgs[max(0, total-limit-offset): total-offset if offset else total]
    return jsonify({'messages': page, 'total': total, 'has_more': (total-limit-offset) > 0})

@app.route('/api/messages/<chat_id>', methods=['POST'])
@auth_required
def send_message(cu, chat_id):
    d        = request.json or {}
    text     = d.get('text', '').strip()
    attach   = d.get('attachment')
    voice    = d.get('voice')
    p2p_file = d.get('p2p_file')
    # NOTE: previously only `text`/`attachment` were checked here, which meant
    # voice messages (text='' , attachment=null) were always rejected as
    # "empty message". Fixed to also accept voice notes and P2P-transfer
    # notices, neither of which carry plain text.
    if not text and not attach and not voice and not p2p_file:
        return err('empty_message')
    if chat_id.startswith('group_'):
        g = load_json(GROUPS_FILE).get(chat_id)
        if not g or cu['id'] not in g.get('members', []): return err('forbidden', 403)
    elif chat_id.startswith('ch_'):
        c = load_json(CHANNELS_FILE).get(chat_id)
        if not c or cu['id'] not in channel_admins(c): return err('no_permission', 403)
    msgs = load_messages(chat_id)
    msg  = {
        'id': str(uuid.uuid4()), 'chat_id': chat_id,
        'sender_id':   cu['id'],
        'sender_name': f"{cu['first_name']} {cu['last_name']}",
        'text': text, 'attachment': attach,
        'voice': voice, 'voice_dur': d.get('voice_dur'),
        'p2p_file': p2p_file,
        'timestamp': datetime.now().isoformat(),
        'read': False, 'reply_to': d.get('reply_to'), 'edited': False,
    }
    msgs.append(msg)
    save_messages(chat_id, msgs)
    socketio.emit('new_message', msg, room=chat_id)
    return jsonify(msg)

@app.route('/api/messages/<chat_id>/<msg_id>', methods=['DELETE'])
@auth_required
def delete_message(cu, chat_id, msg_id):
    msgs = load_messages(chat_id)
    msgs = [m for m in msgs if not (m['id'] == msg_id and m['sender_id'] == cu['id'])]
    save_messages(chat_id, msgs)
    socketio.emit('message_deleted', {'chat_id': chat_id, 'msg_id': msg_id}, room=chat_id)
    return jsonify({'ok': True})

@app.route('/api/messages/<chat_id>/<msg_id>', methods=['PATCH'])
@auth_required
def edit_message(cu, chat_id, msg_id):
    text = (request.json or {}).get('text', '').strip()
    if not text: return err('empty_message')
    msgs = load_messages(chat_id)
    for m in msgs:
        if m['id'] == msg_id and m['sender_id'] == cu['id']:
            m['text'] = text; m['edited'] = True
            save_messages(chat_id, msgs)
            socketio.emit('message_edited', m, room=chat_id)
            return jsonify(m)
    return err('not_found', 404)

# ── GROUPS ────────────────────────────────────────────────────────────────────
def user_brief(uid):
    users = load_json(USERS_FILE)
    u = users.get(uid)
    if not u: return None
    return {'id': u['id'], 'first_name': u['first_name'], 'last_name': u['last_name'],
            'username': u['username'], 'avatar': u.get('avatar')}

@app.route('/api/groups')
@auth_required
def get_groups(cu):
    g = load_json(GROUPS_FILE)
    return jsonify([x for x in g.values() if cu['id'] in x.get('members', [])])

@app.route('/api/groups', methods=['POST'])
@auth_required
def create_group(cu):
    d    = request.json or {}
    name = d.get('name', '').strip()
    if not name: return err('name_required')
    groups = load_json(GROUPS_FILE)
    gid    = 'group_' + str(uuid.uuid4())[:8]
    groups[gid] = {
        'id': gid, 'name': name, 'description': d.get('description', ''),
        'owner': cu['id'],
        'members': list(set([cu['id']] + d.get('members', []))),
        'admins': [cu['id']],
        'created_at': datetime.now().isoformat(), 'avatar': None,
    }
    save_json(GROUPS_FILE, groups)
    return jsonify(groups[gid])

@app.route('/api/groups/<gid>/info')
@auth_required
def group_info(cu, gid):
    groups = load_json(GROUPS_FILE)
    g = groups.get(gid)
    if not g: return err('not_found', 404)
    if cu['id'] not in g['members']: return err('forbidden', 403)
    members = [m for m in (user_brief(uid) for uid in g['members']) if m]
    for m in members:
        m['role'] = 'owner' if m['id'] == g['owner'] else ('admin' if m['id'] in g.get('admins', []) else 'member')
    return jsonify({**g, 'member_details': members})

@app.route('/api/groups/<gid>', methods=['PUT'])
@auth_required
def update_group(cu, gid):
    groups = load_json(GROUPS_FILE)
    g      = groups.get(gid)
    if not g: return err('not_found', 404)
    if cu['id'] not in g.get('admins', []): return err('no_permission', 403)
    d = request.json or {}
    if 'name' in d and d['name'].strip(): g['name'] = d['name'].strip()
    if 'description' in d: g['description'] = d['description']
    save_json(GROUPS_FILE, groups)
    return jsonify(g)

@app.route('/api/groups/<gid>', methods=['DELETE'])
@auth_required
def delete_group(cu, gid):
    groups = load_json(GROUPS_FILE)
    g      = groups.get(gid)
    if not g: return err('not_found', 404)
    if g['owner'] != cu['id']: return err('no_permission', 403)
    del groups[gid]
    save_json(GROUPS_FILE, groups)
    return jsonify({'ok': True})

@app.route('/api/groups/<gid>/members', methods=['POST'])
@auth_required
def add_member(cu, gid):
    groups = load_json(GROUPS_FILE)
    g      = groups.get(gid)
    if not g: return err('not_found', 404)
    if cu['id'] not in g['admins']: return err('no_permission', 403)
    d = request.json or {}
    uids = d.get('user_ids')
    if uids is None:
        single = d.get('user_id')
        uids = [single] if single else []
    added = False
    for uid in uids:
        if uid and uid not in g['members']:
            g['members'].append(uid)
            added = True
    if added: save_json(GROUPS_FILE, groups)
    return jsonify(g)

@app.route('/api/groups/<gid>/members/<uid>', methods=['DELETE'])
@auth_required
def remove_member(cu, gid, uid):
    groups = load_json(GROUPS_FILE)
    g      = groups.get(gid)
    if not g: return err('not_found', 404)
    if cu['id'] not in g.get('admins', []): return err('no_permission', 403)
    if uid == g['owner']: return err('cannot_remove_owner', 403)
    if uid in g.get('admins', []) and cu['id'] != g['owner']:
        return err('no_permission', 403)  # only owner can remove another admin
    g['members'] = [m for m in g['members'] if m != uid]
    g['admins']  = [a for a in g.get('admins', []) if a != uid]
    save_json(GROUPS_FILE, groups)
    socketio.emit('group_member_removed', {'group_id': gid, 'user_id': uid}, room=gid)
    return jsonify(g)

@app.route('/api/groups/<gid>/admins/<uid>', methods=['POST'])
@auth_required
def promote_admin(cu, gid, uid):
    groups = load_json(GROUPS_FILE)
    g      = groups.get(gid)
    if not g: return err('not_found', 404)
    if g['owner'] != cu['id']: return err('no_permission', 403)
    if uid not in g['members']: return err('not_found', 404)
    if uid not in g.setdefault('admins', []):
        g['admins'].append(uid)
        save_json(GROUPS_FILE, groups)
    return jsonify(g)

@app.route('/api/groups/<gid>/admins/<uid>', methods=['DELETE'])
@auth_required
def demote_admin(cu, gid, uid):
    groups = load_json(GROUPS_FILE)
    g      = groups.get(gid)
    if not g: return err('not_found', 404)
    if g['owner'] != cu['id']: return err('no_permission', 403)
    if uid == g['owner']: return err('cannot_demote_owner', 403)
    g['admins'] = [a for a in g.get('admins', []) if a != uid]
    save_json(GROUPS_FILE, groups)
    return jsonify(g)

@app.route('/api/groups/<gid>/leave', methods=['POST'])
@auth_required
def leave_group(cu, gid):
    groups = load_json(GROUPS_FILE)
    g      = groups.get(gid)
    if not g: return err('not_found', 404)
    if g['owner'] == cu['id']: return err('owner_must_delete', 403)
    g['members'] = [m for m in g['members'] if m != cu['id']]
    g['admins']  = [a for a in g.get('admins', []) if a != cu['id']]
    save_json(GROUPS_FILE, groups)
    return jsonify({'ok': True})

# ── CHANNELS ──────────────────────────────────────────────────────────────────
def channel_admins(c):
    """Backward-compatible admin list: channels created before this field
    existed only have an 'owner'. Treat the owner as an implicit admin."""
    admins = c.get('admins')
    if admins is None:
        admins = []
    if c['owner'] not in admins:
        admins = [c['owner']] + admins
    return admins

@app.route('/api/channels')
@auth_required
def get_channels(cu):
    ch = load_json(CHANNELS_FILE)
    return jsonify([c for c in ch.values() if cu['id'] in c.get('subscribers', [])])

@app.route('/api/channels', methods=['POST'])
@auth_required
def create_channel(cu):
    d    = request.json or {}
    name = d.get('name', '').strip()
    if not name: return err('name_required')
    channels = load_json(CHANNELS_FILE)
    cid      = 'ch_' + str(uuid.uuid4())[:8]
    channels[cid] = {
        'id': cid, 'name': name, 'description': d.get('description', ''),
        'owner': cu['id'], 'subscribers': [cu['id']],
        'admins': [cu['id']],
        'public': d.get('public', True),
        'created_at': datetime.now().isoformat(),
    }
    save_json(CHANNELS_FILE, channels)
    return jsonify(channels[cid])

@app.route('/api/channels/<cid>/info')
@auth_required
def channel_info(cu, cid):
    channels = load_json(CHANNELS_FILE)
    c = channels.get(cid)
    if not c: return err('not_found', 404)
    if cu['id'] not in c.get('subscribers', []) and not c.get('public'):
        return err('forbidden', 403)
    admins = channel_admins(c)
    admin_details = [m for m in (user_brief(uid) for uid in admins) if m]
    for m in admin_details:
        m['role'] = 'owner' if m['id'] == c['owner'] else 'admin'
    return jsonify({**c, 'admins': admins, 'admin_details': admin_details})

@app.route('/api/channels/<cid>', methods=['PUT'])
@auth_required
def update_channel(cu, cid):
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if cu['id'] not in channel_admins(c): return err('no_permission', 403)
    d = request.json or {}
    if 'name' in d and d['name'].strip(): c['name'] = d['name'].strip()
    if 'description' in d: c['description'] = d['description']
    if 'public' in d: c['public'] = bool(d['public'])
    save_json(CHANNELS_FILE, channels)
    return jsonify(c)

@app.route('/api/channels/<cid>', methods=['DELETE'])
@auth_required
def delete_channel(cu, cid):
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if c['owner'] != cu['id']: return err('no_permission', 403)
    del channels[cid]
    save_json(CHANNELS_FILE, channels)
    return jsonify({'ok': True})

@app.route('/api/channels/<cid>/subscribe', methods=['POST'])
@auth_required
def subscribe_channel(cu, cid):
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if cu['id'] not in c['subscribers']:
        c['subscribers'].append(cu['id'])
        save_json(CHANNELS_FILE, channels)
    return jsonify(c)

@app.route('/api/channels/<cid>/subscribe', methods=['DELETE'])
@auth_required
def unsubscribe_channel(cu, cid):
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if c['owner'] == cu['id']: return err('owner_must_delete', 403)
    c['subscribers'] = [s for s in c['subscribers'] if s != cu['id']]
    c['admins']       = [a for a in channel_admins(c) if a != cu['id']]
    save_json(CHANNELS_FILE, channels)
    return jsonify({'ok': True})

@app.route('/api/channels/<cid>/subscribers', methods=['POST'])
@auth_required
def add_subscribers(cu, cid):
    """Admins can directly add (invite) users to a channel, instead of
    waiting for the user to self-subscribe."""
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if cu['id'] not in channel_admins(c): return err('no_permission', 403)
    d = request.json or {}
    uids = d.get('user_ids')
    if uids is None:
        single = d.get('user_id')
        uids = [single] if single else []
    added = False
    for uid in uids:
        if uid and uid not in c['subscribers']:
            c['subscribers'].append(uid)
            added = True
    if added: save_json(CHANNELS_FILE, channels)
    return jsonify(c)

@app.route('/api/channels/<cid>/subscribers/<uid>', methods=['DELETE'])
@auth_required
def remove_subscriber(cu, cid, uid):
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if cu['id'] not in channel_admins(c): return err('no_permission', 403)
    if uid == c['owner']: return err('cannot_remove_owner', 403)
    c['subscribers'] = [s for s in c['subscribers'] if s != uid]
    c['admins']       = [a for a in channel_admins(c) if a != uid]
    save_json(CHANNELS_FILE, channels)
    return jsonify(c)

@app.route('/api/channels/<cid>/admins/<uid>', methods=['POST'])
@auth_required
def add_channel_admin(cu, cid, uid):
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if c['owner'] != cu['id']: return err('no_permission', 403)
    if uid not in c['subscribers']: return err('not_found', 404)
    admins = channel_admins(c)
    if uid not in admins:
        admins.append(uid)
        c['admins'] = admins
        save_json(CHANNELS_FILE, channels)
    return jsonify(c)

@app.route('/api/channels/<cid>/admins/<uid>', methods=['DELETE'])
@auth_required
def remove_channel_admin(cu, cid, uid):
    channels = load_json(CHANNELS_FILE)
    c        = channels.get(cid)
    if not c: return err('not_found', 404)
    if c['owner'] != cu['id']: return err('no_permission', 403)
    if uid == c['owner']: return err('cannot_demote_owner', 403)
    c['admins'] = [a for a in channel_admins(c) if a != uid]
    save_json(CHANNELS_FILE, channels)
    return jsonify(c)

@app.route('/api/channels/public')
@auth_required
def public_channels(cu):
    ch = load_json(CHANNELS_FILE)
    return jsonify([c for c in ch.values() if c.get('public')])

# ── BOTS ──────────────────────────────────────────────────────────────────────
#
#  Endpoint map  (all /api/bots/* require Bearer token except webhook)
#  ─────────────────────────────────────────────────────────────────
#  GET    /api/bots                          list your bots
#  POST   /api/bots                          create a bot
#  GET    /api/bots/<bid>                    bot detail
#  PATCH  /api/bots/<bid>                    update name/description/avatar/commands
#  DELETE /api/bots/<bid>                    delete bot
#  POST   /api/bots/<bid>/regen              regenerate API token
#  POST   /api/bots/<bid>/commands           add / upsert a command
#  DELETE /api/bots/<bid>/commands/<name>    remove a command
#  POST   /api/bot/webhook                   send message as bot (X-Bot-Token header)
#
#  Create / update body:
#  {
#    "name":        "MyBot",
#    "description": "Does stuff",
#    "avatar":      "/static/avatars/...",   ← optional URL
#    "commands": [
#      { "name": "/start", "description": "Start", "response": "Hello!" }
#    ]
#  }

@app.route('/api/bots')
@auth_required
def get_bots(cu):
    bots = load_json(BOTS_FILE)
    return jsonify([b for b in bots.values() if b.get('owner') == cu['id']])

@app.route('/api/bots', methods=['POST'])
@auth_required
def create_bot(cu):
    d    = request.json or {}
    name = d.get('name', '').strip()
    if not name: return err('name_required')
    bots = load_json(BOTS_FILE)
    bid  = 'bot_' + str(uuid.uuid4())[:8]
    bots[bid] = {
        'id':          bid,
        'name':        name,
        'description': d.get('description', ''),
        'avatar':      d.get('avatar', None),
        'owner':       cu['id'],
        'token':       str(uuid.uuid4()).replace('-', ''),
        'commands':    d.get('commands', []),
        'created_at':  datetime.now().isoformat(),
    }
    save_json(BOTS_FILE, bots)
    return jsonify(bots[bid]), 201

@app.route('/api/bots/<bid>')
@auth_required
def get_bot(cu, bid):
    bots = load_json(BOTS_FILE)
    b    = bots.get(bid)
    if not b: return err('not_found', 404)
    if b['owner'] != cu['id']: return err('bot_not_yours', 403)
    return jsonify(b)

@app.route('/api/bots/<bid>', methods=['PATCH'])
@auth_required
def update_bot(cu, bid):
    bots = load_json(BOTS_FILE)
    b    = bots.get(bid)
    if not b: return err('not_found', 404)
    if b['owner'] != cu['id']: return err('bot_not_yours', 403)
    d = request.json or {}
    for field in ('name', 'description', 'avatar', 'commands'):
        if field in d: b[field] = d[field]
    save_json(BOTS_FILE, bots)
    return jsonify(b)

@app.route('/api/bots/<bid>', methods=['DELETE'])
@auth_required
def delete_bot(cu, bid):
    bots = load_json(BOTS_FILE)
    b    = bots.get(bid)
    if not b: return err('not_found', 404)
    if b['owner'] != cu['id']: return err('bot_not_yours', 403)
    del bots[bid]
    save_json(BOTS_FILE, bots)
    return jsonify({'ok': True})

@app.route('/api/bots/<bid>/regen', methods=['POST'])
@auth_required
def regen_bot_token(cu, bid):
    bots = load_json(BOTS_FILE)
    b    = bots.get(bid)
    if not b: return err('not_found', 404)
    if b['owner'] != cu['id']: return err('bot_not_yours', 403)
    b['token'] = str(uuid.uuid4()).replace('-', '')
    save_json(BOTS_FILE, bots)
    return jsonify({'token': b['token']})

@app.route('/api/bots/<bid>/commands', methods=['POST'])
@auth_required
def add_bot_command(cu, bid):
    bots = load_json(BOTS_FILE)
    b    = bots.get(bid)
    if not b: return err('not_found', 404)
    if b['owner'] != cu['id']: return err('bot_not_yours', 403)
    d    = request.json or {}
    name = d.get('name', '').strip()
    if not name: return err('command_required')
    b['commands'] = [c for c in b.get('commands', []) if c.get('name') != name]
    b['commands'].append({
        'name':        name,
        'description': d.get('description', ''),
        'response':    d.get('response', ''),
    })
    save_json(BOTS_FILE, bots)
    return jsonify(b)

@app.route('/api/bots/<bid>/commands/<cmd_name>', methods=['DELETE'])
@auth_required
def remove_bot_command(cu, bid, cmd_name):
    bots = load_json(BOTS_FILE)
    b    = bots.get(bid)
    if not b: return err('not_found', 404)
    if b['owner'] != cu['id']: return err('bot_not_yours', 403)
    b['commands'] = [c for c in b.get('commands', []) if c.get('name') != cmd_name]
    save_json(BOTS_FILE, bots)
    return jsonify(b)

# External webhook — post as bot using its token
@app.route('/api/bot/webhook', methods=['POST'])
def bot_webhook():
    bot_token = request.headers.get('X-Bot-Token', '')
    bots      = load_json(BOTS_FILE)
    bot       = next((b for b in bots.values() if b.get('token') == bot_token), None)
    if not bot: return jsonify({'error': 'Invalid bot token'}), 401
    d       = request.json or {}
    chat_id = d.get('chat_id')
    text    = d.get('text', '').strip()
    attach  = d.get('attachment')
    if not chat_id or (not text and not attach):
        return jsonify({'error': 'chat_id and text (or attachment) required'}), 400
    msgs = load_messages(chat_id)
    msg  = {
        'id': str(uuid.uuid4()), 'chat_id': chat_id,
        'sender_id':   bot['id'],
        'sender_name': bot['name'] + ' [bot]',
        'text': text, 'attachment': attach,
        'timestamp': datetime.now().isoformat(),
        'read': False, 'reply_to': d.get('reply_to'), 'edited': False,
        'is_bot': True,
    }
    msgs.append(msg)
    save_messages(chat_id, msgs)
    socketio.emit('new_message', msg, room=chat_id)
    return jsonify(msg), 201

# ── i18n endpoint ─────────────────────────────────────────────────────────────
# GET /api/i18n?lang=en  →  { lang, translations }
@app.route('/api/i18n')
def get_i18n():
    lang = get_lang()
    return jsonify({
        'lang': lang,
        'translations': TRANSLATIONS.get(lang, TRANSLATIONS[DEFAULT_LANG]),
    })

# ── HEALTH CHECK ──────────────────────────────────────────────────────────────
# GET /api/health — no auth required. Meant for a mobile/desktop client to
# ping on startup to confirm it's actually talking to a Pulse server (and to
# check the API_VERSION it speaks) before trying anything else.
API_VERSION = '1.0'

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'api_version': API_VERSION, 'server_time': datetime.now().isoformat()})

# ── CHAT LIST ─────────────────────────────────────────────────────────────────
@app.route('/api/chats')
@auth_required
def get_chats(cu):
    uid      = cu['id']
    users    = load_json(USERS_FILE)
    groups   = load_json(GROUPS_FILE)
    channels = load_json(CHANNELS_FILE)
    chats    = []
    msg_dir  = os.path.join(DATA_DIR, 'messages')
    if os.path.exists(msg_dir):
        for fname in os.listdir(msg_dir):
            cid   = fname.replace('.json', '')
            parts = cid.split('_')
            if (uid in parts and not cid.startswith('group_')
                    and not cid.startswith('ch_') and len(parts) == 2):
                oid = [x for x in parts if x != uid]
                if not oid: continue
                other = users.get(oid[0])
                if other:
                    msgs = load_messages(cid); last = msgs[-1] if msgs else None
                    chats.append({
                        'id': cid, 'type': 'dm',
                        'name':     f"{other['first_name']} {other['last_name']}",
                        'username': other['username'],
                        'other_id': other['id'],
                        'avatar':   other.get('avatar'),
                        'online':   other.get('online', False),
                        'last_message': last,
                        'unread': sum(1 for m in msgs
                                      if not m.get('read') and m['sender_id'] != uid),
                    })
    for g in groups.values():
        if uid in g.get('members', []):
            msgs = load_messages(g['id']); last = msgs[-1] if msgs else None
            chats.append({
                'id': g['id'], 'type': 'group', 'name': g['name'],
                'avatar': g.get('avatar'),
                'members': len(g['members']), 'last_message': last, 'unread': 0,
            })
    for c in channels.values():
        if uid in c.get('subscribers', []):
            msgs = load_messages(c['id']); last = msgs[-1] if msgs else None
            chats.append({
                'id': c['id'], 'type': 'channel', 'name': c['name'],
                'subscribers': len(c['subscribers']),
                'is_owner':    uid in channel_admins(c),
                'last_message': last, 'unread': 0,
            })
    chats.sort(
        key=lambda x: x['last_message']['timestamp'] if x.get('last_message') else '0',
        reverse=True,
    )
    return jsonify(chats)

# ── WEBSOCKET ─────────────────────────────────────────────────────────────────
user_sockets = {}

@socketio.on('connect')
def on_connect():
    tok   = request.args.get('token', '')
    users = load_json(USERS_FILE)
    user  = next((u for u in users.values() if u.get('token') == tok), None)
    if user:
        user_sockets[user['id']] = request.sid
        users[user['id']]['online'] = True
        save_json(USERS_FILE, users)
        emit('connected', {'uid': user['id']})

@socketio.on('disconnect')
def on_disconnect():
    uid = next((k for k, v in user_sockets.items() if v == request.sid), None)
    if uid:
        user_sockets.pop(uid, None)
        users = load_json(USERS_FILE)
        if uid in users:
            users[uid]['online'] = False
            save_json(USERS_FILE, users)

@socketio.on('join')
def on_join(data):
    if data.get('room'): join_room(data['room'])

@socketio.on('leave')
def on_leave(data):
    if data.get('room'): leave_room(data['room'])

@socketio.on('typing')
def on_typing(data):
    emit('typing', data, room=data.get('room'), include_self=False)

@socketio.on('call_offer')
def on_call_offer(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('incoming_call', data, room=sid)
    else:   emit('call_failed', {'reason': t('user_unavailable')})

@socketio.on('call_answer')
def on_call_answer(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('call_answered', data, room=sid)

@socketio.on('call_reject')
def on_call_reject(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('call_rejected', data, room=sid)

@socketio.on('call_end')
def on_call_end(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('call_ended', data, room=sid)

@socketio.on('ice_candidate')
def on_ice(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('ice_candidate', data, room=sid)

# ── P2P FILE TRANSFER (WebRTC DataChannel, no upload to the server) ──────────
# Mirrors the call-signaling pattern above but on its own event namespace so a
# file transfer and a voice/video call can be signaled independently/at once.
@socketio.on('p2p_file_offer')
def on_p2p_file_offer(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('p2p_file_offer', data, room=sid)
    else:   emit('p2p_file_failed', {'reason': t('user_unavailable'), 'transfer_id': data.get('transfer_id')})

@socketio.on('p2p_file_answer')
def on_p2p_file_answer(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('p2p_file_answer', data, room=sid)

@socketio.on('p2p_file_reject')
def on_p2p_file_reject(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('p2p_file_rejected', data, room=sid)

@socketio.on('p2p_file_cancel')
def on_p2p_file_cancel(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('p2p_file_cancelled', data, room=sid)

@socketio.on('p2p_file_ice')
def on_p2p_file_ice(data):
    sid = user_sockets.get(data.get('to_uid'))
    if sid: emit('p2p_file_ice', data, room=sid)

# ── SPA CATCH-ALL ─────────────────────────────────────────────────────────────
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.template_folder, 'index.html')

# ── ENTRY POINT ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    os.chdir(BASE_DIR)
    init_data()

    # HTTPS is configured via environment variables so the same code works for
    # any domain/server, not just one hardcoded host. Defaults preserve the
    # original behaviour if nothing is set.
    #   PULSE_DOMAIN     — your domain (used only for the printed URL)
    #   PULSE_CERT_DIR   — directory containing fullchain.pem + privkey.pem
    #                       (defaults to the standard Let's Encrypt path for PULSE_DOMAIN)
    #   PULSE_HTTPS_PORT — port to bind when serving HTTPS (default 443 — requires root/cap_net_bind_service)
    #   PULSE_HTTP_PORT  — port to bind when falling back to plain HTTP (default 8000)
    DOMAIN     = os.environ.get('PULSE_DOMAIN', 'openmessenger.duckdns.org')
    CERT_DIR   = os.environ.get('PULSE_CERT_DIR', f'/etc/letsencrypt/live/{DOMAIN}')
    CERT_FILE  = os.path.join(CERT_DIR, 'fullchain.pem')
    KEY_FILE   = os.path.join(CERT_DIR, 'privkey.pem')
    HTTPS_PORT = int(os.environ.get('PULSE_HTTPS_PORT', 443))
    HTTP_PORT  = int(os.environ.get('PULSE_HTTP_PORT', 8000))
    use_ssl    = os.path.isfile(CERT_FILE) and os.path.isfile(KEY_FILE)

    if use_ssl:
        print(f"🔒 SSL certs found:\n   cert → {CERT_FILE}\n   key  → {KEY_FILE}")
        print(f"⚡ Pulse Messenger → https://{DOMAIN}" + (f":{HTTPS_PORT}" if HTTPS_PORT != 443 else ""))
        try:
            socketio.run(
                app, host='0.0.0.0', port=HTTPS_PORT,
                debug=False, use_reloader=False,
                allow_unsafe_werkzeug=True,
                certfile=CERT_FILE, keyfile=KEY_FILE,
            )
        except PermissionError:
            print(f"❌ Нет прав на bind порта {HTTPS_PORT} (нужен root/setcap, или задайте PULSE_HTTPS_PORT=8443 и проксируйте через nginx).")
            raise
    else:
        missing = [p for p in (CERT_FILE, KEY_FILE) if not os.path.isfile(p)]
        print("⚠️  SSL cert(s) not found:", *missing, sep='\n   ')
        print(f"   Set PULSE_DOMAIN / PULSE_CERT_DIR env vars if your certs live elsewhere.")
        print(f"   Falling back to HTTP on port {HTTP_PORT}.")
        print(f"⚡ Pulse Messenger → http://localhost:{HTTP_PORT}")
        socketio.run(
            app, host='0.0.0.0', port=HTTP_PORT,
            debug=False, use_reloader=False,
            allow_unsafe_werkzeug=True,
        )
