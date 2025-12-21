# Usage Guide

This document is a compact version of the API documentation extracted from the local HTML dump.  We copied the html from the browser inspector and then used the `scripts/extract-usage.ts` script to convert the html to AI friendly markdown.  This will help if there are API updates in the future to implement.  From https://tools.sidus.link/openapi/docs/usage

## 1. Overview

This document provides the details of the WebSocket communication protocol for the amaran openapi platform, supporting request-response and event push interactions between the client and the server.

> Note: The server will process every request sent by the client and will also affect the application, but it may not necessarily affect the device, because the device can only process requests at an interval of every 200ms, which means that if the client sends 10 requests within 200ms, only the last request will be processed by the device.

## 2. Protocol Structure and Types

The protocol mainly includes the following three types of messages:

* Request: Requests sent by the client to the server.
* Response: The server's response to the request.
* Event: Event messages actively pushed by the server.

### Request Message

A Request is a request sent by the client to the server, and its structure is as follows:

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "get_protocol_versions",
  "token": "Nx9CQYZmHVfcO0YjQqBIUJJUv8kuRGe5f9ygM73RIfQAbKSTDaQ="
}
```

#### Field Description

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| version | integer | Yes | Protocol version |
| type | string | Yes | Message type |
| client_id | integer | string | No | Client ID |
| request_id | integer | string | No | Request ID |
| node_id | string | No | Device or group ID |
| action | string | Yes | Request type |
| args | object | No | Request parameters |
| user_data | any | No | User-defined data |
| token | string | Yes | Request token |


### Response Message

A Response is the server's response to a request, and its structure is as follows:

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "get_protocol_versions",
  "data": [
    2
  ]
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| code | integer | Yes | Error code |
| message | string | Yes | Error message |
| version | integer | Yes | Protocol version |
| type | string | Yes | Message type |
| client_id | integer | string | No | Client ID |
| request_id | integer | string | No | Request ID |
| node_id | string | No | Device or group ID |
| action | string | Yes | Request type |
| data | any | No | Response data |
| user_data | any | No | User-defined data |


#### Detailed Description

* client_id: Used to identify the client making the request, a custom value.
* request_id: A unique identifier used to distinguish different requests, a custom value.
* node_id: Can be obtained through the requestsget_fixture_list,get_fixture_list,get_scene_listto get the corresponding device or group ID, for details, please refer to the protocol description of each request.
* The values ofversion,client_id,request_id,node_id,type,user_datafields remain consistent in both Request and Response to facilitate tracking and matching of requests and responses.

### Event Message

An Event is an event actively pushed by the server to notify the client of status changes or other important information. Its structure is as follows:

```json
{
  "version": 2,
  "type": "event",
  "event": "cct_changed",
  "cause_by": 1,
  "node_id": "05005-ccdde2",
  "data": {
    "cct": 5000
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| version | integer | Yes | Protocol version |
| type | string | Yes | Message type |
| event | string | Yes | Event type |
| cause_by | integer | string | No | Event trigger source |
| node_id | string | No | Device or group ID |
| data | any | No | Event data, consistent with the data in Response |


#### Detailed Description of cause_by Field

* Triggered by API request:
  * If the request contains the client_id field, the cause_by value is the corresponding client_id.
  * If the request does not contain the client_id field, the cause_by value is the string "openapi".
* Triggered by non-API requests:
  * If the event is triggered by App operation, the cause_by value is the string "app".

#### Supported Event Types

| Event Type | Description |
| --- | --- |
| sleep_changed | Device enters or exits sleep mode |
| intensity_changed | Device brightness changes |
| cct_changed | Device color temperature changes |
| hsi_changed | Device HSI mode changes |
| rgb_changed | Device RGB mode changes |
| effect_changed | Device light effect changes |


## 3. Server Startup and Connection

After amaran Desktop starts, it will start the WebSocket server, listening at 0.0.0.0:12345, waiting for client connections.

## 4. Example Code

### Python Example

The following is a simple example of implementing WebSocket communication using Python:

**openapi_demo.py**
```python
import asyncio
import json
import time
import os
import base64

import websockets
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


# API secret key applied for
api_secret_key = '9veqiL0G0EUOviwzL1prPc0iGIGUJtbzSaPYQfgfyxM='


# Generate token using AES-256-GCM algorithm
def generate_token(secret_key: str) -> str:
iv = os.urandom(12)
encryptor = Cipher(algorithms.AES(base64.b64decode(secret_key)), modes.GCM(iv), backend=default_backend()).encryptor()
# Must use the current timestamp, which will be used to calculate the token's expiration time, must be an integer
now = int(time.time())
ciphertext = encryptor.update(str(now).encode()) + encryptor.finalize()
combined = iv + encryptor.tag + ciphertext
return base64.b64encode(combined).decode()


async def websocket_client():
uri = "ws://127.0.0.1:12345"

async with websockets.connect(uri) as websocket:
request_message = {
"version": 2,
"type": "request",
"client_id": 1,
"request_id": 123,
"action": "get_protocol_versions",
# Generate a new token for each request, otherwise the token will expire, the validity period is 10s
"token": generate_token(api_secret_key),
}

await websocket.send(json.dumps(request_message))
print(f"Sent: {request_message}")

response = await websocket.recv()
print(f"Received: {response}")


asyncio.run(websocket_client())
```

#### Running Steps

1. Ensure that amaran Desktop has started
2. Install the necessary Python libraries:pip install websockets cryptography
3. Run the code:python openapi_demo.py

### Node.js Example

The following is a simple example of implementing WebSocket communication using Node.js:

**openapi_demo.js**
```javascript
const WebSocket = require('ws')
const crypto = require('crypto')

// API secret key applied for
const apiSecretKey = '9veqiL0G0EUOviwzL1prPc0iGIGUJtbzSaPYQfgfyxM='

// Generate token using AES-256-GCM algorithm
function generateToken (secretKey) {
const iv = crypto.randomBytes(12)
const aes256gcm = crypto.createCipheriv('aes-256-gcm', Buffer.from(secretKey, 'base64'), iv)

// Must use the current timestamp, which will be used to calculate the token's expiration time, must be an integer
const now = Math.floor(Date.now() / 1000)
let encrypted = aes256gcm.update(now.toString(), 'utf8', 'hex')
encrypted += aes256gcm.final('hex')

const authTag = aes256gcm.getAuthTag()
const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')])
return combined.toString('base64')
}

const websocket = new WebSocket("ws://127.0.0.1:12345")

websocket.on('open', function open () {
const requestMessage = {
version: 2,
type: 'request',
client_id: 1,
request_id: 123,
action: 'get_protocol_versions',
// Generate a new token for each request, otherwise the token will expire, the validity period is 10s
token: generateToken(apiSecretKey)
}

websocket.send(JSON.stringify(requestMessage))
console.log(`Sent: ${JSON.stringify(requestMessage)}`)
})

websocket.on('message', function incoming (data) {
console.log(`Received: ${data}`)
})

websocket.on('error', function error (err) {
console.error('WebSocket encountered error: ', err.message, err)
})

websocket.on('close', function close () {
console.log('Disconnected from the WebSocket server.')
})
```

1. Ensure that amaran Desktop has started
2. Install the necessary Node.js libraries:npm install ws
3. Run the code:node openapi_demo.js
