# 📡 Pulse API — для мобильного приложения (Java/Android)

Хорошая новость: этот API **уже реальный и рабочий** — им и так пользуется веб-версия
(`static/js/app.js` дёргает ровно эти же эндпоинты). Ничего "показательного" тут нет,
можно смело строить на нём Android-приложение.

Два канала связи:
- **REST (HTTP + JSON)** — всё, что не требует мгновенной доставки: логин, чаты, сообщения, контакты
- **WebSocket (Socket.IO)** — реальное время: новые сообщения, звонки, "печатает...", статус онлайн

---

## 0. Базовый адрес

```
http://<IP_ТВОЕГО_СЕРВЕРА>:8000
```

⚠️ Важно: с телефона `localhost` — это сам телефон, а не твой компьютер.
Если сервер крутится у тебя на ПК, а Android-эмулятор/устройство подключаются к нему —
используй IP компьютера в локальной сети (`192.168.x.x`) или домен, если задеплоил на хостинг
(см. `README.md` → раздел "Деплой на сервер").

Проверка соединения (не требует токена):
```
GET /api/health
→ { "status": "ok", "api_version": "1.0", "server_time": "..." }
```

---

## 1. Аутентификация

Все защищённые запросы требуют заголовок:
```
Authorization: Bearer <token>
```
Токен ты получаешь один раз при регистрации/логине и хранишь на телефоне
(`SharedPreferences` / `EncryptedSharedPreferences`).

### Регистрация
```
POST /api/register
Content-Type: application/json

{ "first_name": "Иван", "last_name": "Иванов", "username": "ivan", "password": "123456" }
```
Ответ:
```json
{
  "token": "758f289a-...",
  "user": {
    "id": "d886eabb-...", "first_name": "Иван", "last_name": "Иванов",
    "username": "ivan", "number": "08574137", "avatar": null,
    "status": "Привет, я использую Pulse!", "online": true,
    "created_at": "2026-07-30T02:37:37", "contacts": [],
    "theme": "dark", "lang": "ru"
  }
}
```

### Логин
```
POST /api/login
{ "username": "ivan", "password": "123456" }
```
→ тот же формат ответа (`token` + `user`). Логин выдаёт новый токен, старый перестаёт работать.

### Выход
```
POST /api/logout          (Authorization: Bearer <token>)
```

### Кто я
```
GET /api/me
```

---

## 2. Профиль

### Обновить имя/фамилию/описание/тему/язык
```
POST /api/me/update
{ "first_name": "...", "last_name": "...", "status": "новое описание", "theme": "dark", "lang": "ru" }
```
Все поля опциональны — присылай только то, что меняешь.

### Загрузить фото профиля
```
POST /api/me/avatar
Content-Type: multipart/form-data
поле: avatar = <файл изображения>
```
→ `{ "avatar": "/static/avatars/xxxxx.jpg" }`

---

## 3. Пользователи и контакты

```
GET  /api/users/search?q=иван        поиск по имени/@username/#номеру
GET  /api/users/<user_id>            профиль конкретного пользователя
GET  /api/contacts                   список своих контактов
POST /api/contacts/add    { "user_id": "..." }
POST /api/contacts/remove { "user_id": "..." }
```

QR-код для добавления в контакты — это просто текст `pulse:contact:<user_id>`,
который веб-версия кодирует в QR. Для Android можно генерировать так же (например,
библиотекой ZXing) и сканировать этим же ZXing/ML Kit, а затем звать `/api/contacts/add`.

---

## 4. Список чатов и сообщения

### Все чаты (личные + группы + каналы одним списком)
```
GET /api/chats
```
Ответ — массив объектов с полями `id, type (dm/group/channel), name, avatar,
online, last_message, unread`.

### История сообщений конкретного чата
```
GET /api/messages/<chat_id>?offset=0&limit=50
```
`chat_id` для личных чатов — это `<id1>_<id2>` (id пользователей через `_`, отсортированные),
для групп/каналов — их собственный `id` (совпадает с полем `id` из `/api/chats`).

### Отправить сообщение
```
POST /api/messages/<chat_id>
{ "text": "привет" }
```
Поддерживаются также поля `voice` (голосовое, base64/URL — смотри `app.py` вокруг
`/api/messages` для точного формата) и `reply_to` (id сообщения, на которое отвечаем).

### Удалить / редактировать
```
DELETE /api/messages/<chat_id>/<msg_id>
PATCH  /api/messages/<chat_id>/<msg_id>   { "text": "новый текст" }
```

### Загрузка файла (фото/видео/документ)
```
POST /api/upload
Content-Type: multipart/form-data
поле: file = <файл>
```
Файл проверяется по содержимому (magic bytes), а не по расширению. Ответ содержит URL
файла и извлечённые метаданные (размер изображения, EXIF, длительность аудио/видео и т.п.).

---

## 5. Группы и каналы

```
GET  /api/groups
POST /api/groups                       { "name": "...", "description": "...", "members": ["uid1","uid2"] }
POST /api/groups/<gid>/members         { "user_id": "..." }
POST /api/groups/<gid>/leave

GET  /api/channels
POST /api/channels                     { "name": "...", "description": "...", "public": true }
POST /api/channels/<cid>/subscribe
GET  /api/channels/public               каталог публичных каналов
```

---

## 6. Боты

```
GET    /api/bots
POST   /api/bots                        { "name": "...", "description": "..." }
GET    /api/bots/<bid>
PATCH  /api/bots/<bid>
DELETE /api/bots/<bid>
POST   /api/bots/<bid>/regen             перегенерировать токен бота
POST   /api/bots/<bid>/commands          { "name": "/start", "response": "..." }
DELETE /api/bots/<bid>/commands/<name>
```

---

## 7. Реальное время — Socket.IO

Android: подключи клиент `io.socket:socket.io-client` (см. пример ниже). Сервер слушает
на том же порту (8000), путь по умолчанию `/socket.io/`.

**Входящие события (слушать):**
| Событие | Когда приходит |
|---|---|
| `new_message` | новое сообщение в чате |
| `message_deleted` / `message_edited` | удаление/правка |
| `typing` | собеседник печатает |
| `incoming_call` / `call_answered` / `call_rejected` / `call_ended` | сигналинг звонков |
| `ice_candidate` | WebRTC ICE-кандидат (для звонков и P2P-файлов) |
| `contact_added` | кто-то добавил тебя в контакты |
| `user_updated` | у пользователя изменился аватар/данные |

**Исходящие события (эмитить):**
| Событие | Зачем |
|---|---|
| `join` / `leave` | войти/выйти из комнаты чата: `{ "room": chat_id }` |
| `typing` | сообщить, что печатаешь: `{ "room": chat_id, "user_id": ..., "name": ... }` |
| `call_offer` / `call_answer` / `call_reject` / `call_end` | звонки |
| `ice_candidate` | WebRTC сигналинг |

---

## 8. Пример на Java (Android)

`build.gradle`:
```gradle
implementation 'com.squareup.retrofit2:retrofit:2.11.0'
implementation 'com.squareup.retrofit2:converter-gson:2.11.0'
implementation 'com.squareup.okhttp3:okhttp:4.12.0'
implementation 'io.socket:socket.io-client:2.1.0'
```

Retrofit-интерфейс (фрагмент):
```java
public interface PulseApi {
    @POST("/api/login")
    Call<AuthResponse> login(@Body LoginRequest body);

    @GET("/api/chats")
    Call<List<Chat>> getChats(@Header("Authorization") String bearerToken);

    @POST("/api/messages/{chatId}")
    Call<Message> sendMessage(@Header("Authorization") String bearerToken,
                              @Path("chatId") String chatId,
                              @Body MessageRequest body);
}

Retrofit retrofit = new Retrofit.Builder()
    .baseUrl("http://192.168.1.50:8000")
    .addConverterFactory(GsonConverterFactory.create())
    .build();
PulseApi api = retrofit.create(PulseApi.class);
```

Socket.IO-клиент:
```java
IO.Options opts = new IO.Options();
opts.extraHeaders = Collections.singletonMap(
    "Authorization", Collections.singletonList("Bearer " + token));
Socket socket = IO.socket("http://192.168.1.50:8000", opts);

socket.on("new_message", args -> {
    JSONObject msg = (JSONObject) args[0];
    // обновить UI в главном потоке (runOnUiThread)
});
socket.connect();
```

---

## 9. Что важно помнить

- Токен не имеет срока жизни в этой версии — храни его надёжно (`EncryptedSharedPreferences`),
  логика "выйти со всех устройств" = перевыпуск токена при логине
- Все ошибки возвращаются как `{ "error": "человекочитаемый текст", "key": "machine_key" }`
  с соответствующим HTTP-статусом (400/401/403/404) — удобно матчить по `key`, а не по тексту
- Если сервер запущен по HTTPS с настоящим сертификатом (см. README) — используй `https://` и
  `wss://` в адресах, иначе обычный Android без доп. настроек откажется коннектиться на HTTP
  начиной с Android 9 (нужно разрешить cleartext-трафик в `network_security_config.xml` для теста)
