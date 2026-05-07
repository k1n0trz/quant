# 🔐 QUANT API CONTRACT - OFFICIAL SPECIFICATION

**Status:** ⏳ PENDING - Awaiting Backend Implementation  
**Created:** 2026-05-06  
**For:** Backend Team (Codex)  
**By:** Frontend Team (Claude)

---

## 📋 INSTRUCTIONS FOR BACKEND TEAM

This document defines the exact API contract that Frontend expects.

**Your responsibility:**
1. Implement these endpoints EXACTLY as specified
2. Return payloads with EXACT field names and types
3. Use EXACT HTTP status codes
4. Handle error cases with specified codes
5. Return this completed document with actual values

**DO NOT:**
- ❌ Change field names
- ❌ Omit fields
- ❌ Add extra fields without notification
- ❌ Change HTTP methods
- ❌ Use different status codes
- ❌ Return different error structures

**DO:**
- ✅ Match field names exactly
- ✅ Use correct data types
- ✅ Return proper status codes
- ✅ Fill in all required fields
- ✅ Document any differences

---

## 🔴 BLOCKING ISSUE

**Frontend cannot proceed to PHASE 2 without this contract.**

Current situation:
- Frontend has stub implementations
- Backend endpoints are TBD
- Risk: Frontend and Backend diverge
- Solution: Define contract NOW, before more code

---

# ⚙️ ENDPOINT SPECIFICATIONS

## ENDPOINT 1: Enable Trading Real

**Frontend currently calls:**
```javascript
POST /api/bot/trading-real/on
```

**Specification:**

| Property | Value |
|----------|-------|
| **Method** | POST |
| **Path** | `/api/bot/trading-real/on` |
| **Auth Required** | [ ] Yes [ ] No |
| **Body** | None OR specify below: |
| **Content-Type** | application/json |

**Request Body (if any):**
```json
{
  // Codex: Specify if body is needed
  // Example:
  // "reason": "User enabled trading"
}
```

**Success Response (HTTP 200):**
```json
{
  "ok": true,
  "state": {
    "trading_real_enabled": true,
    "timestamp": "2026-05-06T14:30:00Z",
    "previous_state": false
  }
}
```

**OR if different, specify:**
```json
{
  // Codex: Provide ACTUAL response format
}
```

**Error Response (specify status code):**

| Code | Condition | Response |
|------|-----------|----------|
| 400 | Already enabled | `{"ok": false, "error": "Trading already enabled"}` |
| 409 | Conflict | `{"ok": false, "error": "..."}` |
| 500 | Server error | `{"ok": false, "error": "Internal server error"}` |

**Actual implementation (Codex):**
- [ ] Status code: ___
- [ ] Response format: (paste JSON)
- [ ] Error cases: (list with codes)

---

## ENDPOINT 2: Disable Trading Real

**Frontend currently calls:**
```javascript
POST /api/bot/trading-real/off
```

**Specification:**

| Property | Value |
|----------|-------|
| **Method** | POST |
| **Path** | `/api/bot/trading-real/off` |
| **Auth Required** | [ ] Yes [ ] No |
| **Body** | None OR: |

**Request Body (if any):**
```json
{
  // Codex: Specify if needed
}
```

**Success Response:**
```json
{
  "ok": true,
  "state": {
    "trading_real_enabled": false,
    "timestamp": "2026-05-06T14:30:00Z",
    "previous_state": true
  }
}
```

**Error Responses:**

| Code | Condition |
|------|-----------|
| ??? | ??? |

**Actual implementation (Codex):**
- [ ] Status code: ___
- [ ] Response: (paste actual)
- [ ] Errors: (list)

---

## ENDPOINT 3: Enable Training

**Frontend currently calls:**
```javascript
POST /api/bot/training/on
```

**Specification:**

| Property | Value |
|----------|-------|
| **Method** | POST |
| **Path** | `/api/bot/training/on` |
| **Auth Required** | [ ] Yes [ ] No |
| **Body** | None OR: |

**Request Body:**
```json
{
  // Codex: Define
}
```

**Success Response:**
```json
{
  "ok": true,
  "state": {
    "training_enabled": true,
    "timestamp": "2026-05-06T14:30:00Z",
    "previous_state": false
  }
}
```

**Error Responses:**

| Code | Condition |
|------|-----------|
| ??? | ??? |

**Actual implementation (Codex):**
- [ ] Status code: ___
- [ ] Response: (paste)
- [ ] Errors: (list)

---

## ENDPOINT 4: Disable Training

**Frontend currently calls:**
```javascript
POST /api/bot/training/off
```

**Specification:**

| Property | Value |
|----------|-------|
| **Method** | POST |
| **Path** | `/api/bot/training/off` |
| **Auth Required** | [ ] Yes [ ] No |
| **Body** | None OR: |

**Request Body:**
```json
{
  // Codex: Define
}
```

**Success Response:**
```json
{
  "ok": true,
  "state": {
    "training_enabled": false,
    "timestamp": "2026-05-06T14:30:00Z",
    "previous_state": true
  }
}
```

**Error Responses:**

| Code | Condition |
|------|-----------|
| ??? | ??? |

**Actual implementation (Codex):**
- [ ] Status code: ___
- [ ] Response: (paste)
- [ ] Errors: (list)

---

## ENDPOINT 5: Kill Switch (Emergency Stop)

**Frontend currently calls:**
```javascript
POST /api/bot/kill-switch
```

**Specification:**

| Property | Value |
|----------|-------|
| **Method** | POST |
| **Path** | `/api/bot/kill-switch` |
| **Auth Required** | [ ] Yes [ ] No |
| **Body** | None OR: |

**Request Body:**
```json
{
  // Codex: Define
  // Reason? Confirmation token? Timestamp?
}
```

**Success Response:**
```json
{
  "ok": true,
  "state": {
    "trading_real_enabled": false,
    "training_enabled": false,
    "all_operations_stopped": true,
    "timestamp": "2026-05-06T14:30:00Z",
    "reason": "Emergency stop activated by user"
  }
}
```

**Error Responses:**

| Code | Condition |
|------|-----------|
| ??? | Already stopped |
| ??? | Server error |

**Actual implementation (Codex):**
- [ ] Status code: ___
- [ ] Response: (paste)
- [ ] Errors: (list)

---

# 📊 DATA ENDPOINTS (For Hero Section Updates)

These endpoints provide the data that hero section displays.

## ENDPOINT 6: Get Bot Status

**Frontend needs for hero section to update P&L, confidence, etc.**

**Frontend currently calls:**
```javascript
GET /api/status
```

**Expected response:**
```json
{
  "ok": true,
  "bot_state": {
    "trading_real_enabled": true,
    "training_enabled": true,
    "mode": "OPERATING",  // IDLE | TRADING | LEARNING | OPERATING
    "timestamp": "2026-05-06T14:30:00Z"
  }
}
```

**Codex should return:**
```json
{
  // Fill with ACTUAL response format
}
```

**Actual implementation (Codex):**
- [ ] Endpoint: GET ___
- [ ] Response: (paste)
- [ ] Frequency needed: (How often frontend calls this)

---

## ENDPOINT 7: Get Today's Trades

**Frontend needs for P&L calculation in hero section**

**Frontend currently calls:**
```javascript
GET /api/trades?date=today
```

**Expected response:**
```json
{
  "ok": true,
  "trades": [
    {
      "id": "trade_123",
      "timestamp": "2026-05-06T10:30:00Z",
      "symbol": "BTCUSDT",
      "side": "BUY",  // BUY | SELL
      "price": 42500.50,
      "quantity": 0.1,
      "realized_profit": 150.75,  // +/- value
      "status": "CLOSED"  // OPEN | CLOSED
    }
  ]
}
```

**Codex should return:**
```json
{
  // Fill with ACTUAL response
}
```

**Actual implementation (Codex):**
- [ ] Endpoint: GET ___
- [ ] Response: (paste)
- [ ] Query params: (date=today? date range?)
- [ ] Filtering: (realtime/demo trades? both?)

---

## ENDPOINT 8: Get Signals/Confidence

**Frontend needs for confidence meter in hero section**

**Frontend currently calls:**
```javascript
GET /api/signals
```

**Expected response:**
```json
{
  "ok": true,
  "signal": {
    "direction": "LONG",  // LONG | SHORT | NEUTRAL
    "strength": 0.87,  // 0.0 to 1.0
    "confidence": 87,  // 0 to 100
    "timestamp": "2026-05-06T14:30:00Z"
  }
}
```

**Codex should return:**
```json
{
  // Fill with ACTUAL response
}
```

**Actual implementation (Codex):**
- [ ] Endpoint: GET ___
- [ ] Response: (paste)
- [ ] Frequency: (How often changes?)

---

# 🔑 ADDITIONAL QUESTIONS FOR CODEX

1. **Authentication:**
   - [ ] Does every endpoint need auth token?
   - [ ] How is auth passed? (Header? Body?)
   - [ ] What's the header name?

2. **Base URL:**
   - [ ] What's the base URL? (localhost:3000? /api/?)
   - [ ] Port number?
   - [ ] CORS enabled?

3. **Response Format:**
   - [ ] All responses have `"ok"` field?
   - [ ] All errors have `"error"` field?
   - [ ] Are there warnings/partial failures?

4. **State Persistence:**
   - [ ] When trading real is enabled, does it persist across server restarts?
   - [ ] Where is state stored? (Memory? Database?)
   - [ ] Is there initial state to load on startup?

5. **Async Operations:**
   - [ ] Are operations synchronous (respond immediately)?
   - [ ] Or async (respond with status, then update later)?
   - [ ] Do we need polling endpoints?

6. **Rate Limiting:**
   - [ ] Are there rate limits?
   - [ ] How many requests per second?
   - [ ] What's the error when limit exceeded?

7. **Real vs Demo:**
   - [ ] Separate endpoints for real/demo?
   - [ ] Or query parameter?
   - [ ] Frontend needs to know which mode?

8. **Additional Endpoints:**
   - [ ] Are there other endpoints frontend should know about?
   - [ ] /api/bot/state?
   - [ ] /api/trades/open?
   - [ ] /api/positions?
   - [ ] List them here: ___

---

# ✅ DELIVERY CHECKLIST FOR CODEX

Before returning this document, confirm:

- [ ] All 8 endpoints implemented (or less if intentional)
- [ ] All field names match exactly
- [ ] All data types are correct
- [ ] All HTTP status codes filled in
- [ ] All error cases documented
- [ ] All responses tested with actual calls
- [ ] CORS enabled for frontend calls
- [ ] No divergence from spec above
- [ ] This document filled completely
- [ ] Additional questions answered

---

# 📋 TEMPLATE FOR CODEX RESPONSE

**When ready, Codex should respond with:**

```
✅ CODEX API IMPLEMENTATION COMPLETE

Status: Ready for Frontend Integration

Completed Endpoints:
☑ POST /api/bot/trading-real/on → [Response format]
☑ POST /api/bot/trading-real/off → [Response format]
☑ POST /api/bot/training/on → [Response format]
☑ POST /api/bot/training/off → [Response format]
☑ POST /api/bot/kill-switch → [Response format]
☑ GET /api/status → [Response format]
☑ GET /api/trades → [Response format]
☑ GET /api/signals → [Response format]

Base URL: [Base URL]
Auth: [None / Bearer / Custom]
CORS: [Enabled / Disabled]

Additional Info:
[Any other relevant details]

Full Response Schemas Attached Below:
[Paste actual response examples]
```

---

# 🚨 BLOCKING CRITERIA

**Frontend CANNOT proceed until:**

1. ✅ All 5 POST endpoints implemented
2. ✅ All response formats defined
3. ✅ All error cases documented
4. ✅ Base URL specified
5. ✅ Auth method (if any) specified
6. ✅ CORS enabled for localhost
7. ✅ Endpoints tested and working
8. ✅ This document completed

**Once Codex delivers this, Claude will:**

1. Update frontend code to match exact responses
2. Remove mock/stub implementations
3. Add error handling for each code
4. Connect frontend to real backend
5. Run integration tests
6. Proceed to PHASE 2

---

**WAITING FOR CODEX DELIVERY** ⏳

This document is the contract. Until Codex fills it completely, Frontend work is PAUSED.

No PHASE 2 until this is RESOLVED.
