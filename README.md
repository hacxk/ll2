## 1. Create Connection

**Endpoint**: `POST /whatsapp/connect`

**Body Parameters**:
```typescript
{
  userId: string;
  pairingCode?: string;
}
```

**Return Value**:
```typescript
{
  message: string;
}
```

## 2. Close Connection

**Endpoint**: `POST /whatsapp/close-connection/:userId`

**URL Parameters**:
- `userId`: string

**Return Value**:
```typescript
{
  message: string;
}
```

## 3. Logout

**Endpoint**: `POST /whatsapp/logout/:userId`

**URL Parameters**:
- `userId`: string

**Return Value**:
```typescript
{
  message: string;
}
```

## 4. Send Message

**Endpoint**: `POST /whatsapp/send-message`

**Body Parameters**:
```typescript
{
  userId: string;
  to: string;
  content: string;
}
```

**Return Value**:
```typescript
{
  message: string;
}
```

## 5. Get QR Code

**Endpoint**: `GET /whatsapp/qr/:userId`

**URL Parameters**:
- `userId`: string

**Return Value**:
```typescript
{
  qr: string | null;
}
```

## 6. Get Connection Status

**Endpoint**: `GET /whatsapp/status/:userId`

**URL Parameters**:
- `userId`: string

**Return Value**:
```typescript
{
  status: {
    isConnected: boolean;
    lastConnected: Date | null;
    lastDisconnected: Date | null;
  }
}
```

## 7. QR Stream

**Endpoint**: `SSE /whatsapp/qr-stream/:userId`

**URL Parameters**:
- `userId`: string

**Return Value**: Server-Sent Events stream
```typescript
{
  data: {
    qr: string;
  }
}
```

## 8. Is Connected

**Endpoint**: `GET /whatsapp/is-connected/:userId`

**URL Parameters**:
- `userId`: string

**Return Value**:
```typescript
{
  connected: boolean;
}
```

## 9. Generate Pairing Code

**Endpoint**: `POST /whatsapp/generate-pairing-code`

**Body Parameters**:
```typescript
{
  userId: string;
  phoneNumber: string;
}
```

**Return Value**:
```typescript
{
  pairingCode: string;
}
```

## 10. Health Check

**Endpoint**: `GET /whatsapp/health`

**Return Value**:
```typescript
{
  status: string;
  message: string;
}
```

Get Saved Groups Endpoint
This endpoint retrieves the saved groups for a specific user.
Endpoint Details
Method: GET
Path: /groups/:userId
Parameters

    userId (string): The unique identifier of the user

Response
The endpoint returns a JSON object with the following structure:

json
{
  "success": boolean,
  "groups": GroupMetadata[]
}

Where GroupMetadata is an array of group objects containing details about each saved group.
Error Handling
If an error occurs, the endpoint will throw an HttpException with the following structure:

json
{
  "status": HttpStatus.BAD_REQUEST,
  "error": string
}



# Chat File Manager Service


## Usage

### FileManagerService Methods

#### saveChat(chatData: ChatData): Promise<ChatDataWithId>

Saves a new chat entry.

#### readChat(userID: string, id: string): Promise<ChatDataWithId | null>

Reads a specific chat entry.

#### listUserChats(userID: string): Promise<ChatDataWithId[]>

Lists all chat entries for a user.

#### deleteChat(userID: string, id: string): Promise<boolean>

Deletes a specific chat entry.

### API Endpoints

#### POST /chats

Save a new chat entry.

Request body:
```json
{
  "userID": "1",
  "fromJid": "132323",
  "toJid": "4343",
  "fromjidName": "Alice",
  "toJidName": "Bob",
  "timestamp": "2024-09-18T15:44:00Z"
}
```

Response:
```json
{
  "message": "Chat saved successfully",
  "chat": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "userID": "1",
    "fromJid": "132323",
    "toJid": "4343",
    "fromjidName": "Alice",
    "toJidName": "Bob",
    "timestamp": "2024-09-18T15:44:00Z"
  }
}
```

#### GET /chats/:userId/:chatId

Retrieve a specific chat entry.

Response:
```json
{
  "chat": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "userID": "1",
    "fromJid": "132323",
    "toJid": "4343",
    "fromjidName": "Alice",
    "toJidName": "Bob",
    "timestamp": "2024-09-18T15:44:00Z"
  }
}
```

#### GET /chats/:userId

List all chat entries for a user.

Response:
```json
{
  "chats": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "userID": "1",
      "fromJid": "132323",
      "toJid": "4343",
      "fromjidName": "Alice",
      "toJidName": "Bob",
      "timestamp": "2024-09-18T15:44:00Z"
    },
    {
      "id": "234e5678-e89b-12d3-a456-426614174001",
      "userID": "1",
      "fromJid": "132323",
      "toJid": "5454",
      "fromjidName": "Alice",
      "toJidName": "Charlie",
      "timestamp": "2024-09-18T16:00:00Z"
    }
  ]
}
```

#### DELETE /chats/:userId/:chatId

Delete a specific chat entry.

Response:
```json
{
  "message": "Chat deleted successfully"
}
```

## File Structure

Chat entries are stored in the following directory structure:

```
store/
  userid1/
    2024-09-18_123e4567-e89b-12d3-a456-426614174000.json
    2024-09-18_234e5678-e89b-12d3-a456-426614174001.json
  userid2/
    2024-09-17_345e6789-e89b-12d3-a456-426614174002.json
    ...
```

Each file is named with the format: `{date}_{uuid}.json`

