<p align="center">
<img src="./logo.svg" width="220px" alt="logo">
</p>
<p align="center">
A lightweight modern library for seamless two-way communication between a main application and an iframe.
</p>


## Features
- **Zero-Dependency:** Pure JavaScript implementation.
- **Secure:** Uses `MessageChannel` and strict `origin` validation to prevent data leakage.
- **Performance:** Direct communication via `MessagePort` bypasses the global window message bus.
- **Reliable:** Built-in handshake mechanism to ensure the connection is established only when both sides are ready.

---

## Usage

### 1. Main Application (Host)

Initialize the communication by providing the iframe element and the expected origin of the child application.

```html
<script src="https://cdn.jsdelivr.net/gh/kossyak/iboxjs@latest/ibox.min.js"></script>
```

```javascript
const iframe = document.querySelector('#my-iframe')
const messenger = await ibox.host(iframe, 'https://child-app.com')

// Listen for events from the iframe
messenger.on('request_data', (data) => {
  console.log('Iframe requested:', data)
})

// Send events to the iframe
messenger.emit('set_theme', { color: 'blue' })

// Cleanup when needed
// messenger.destroy()
```
### 2. Iframe Application (Client)

The client method returns a Promise that resolves once the secure channel is established with the host.
```html
<script src="https://cdn.jsdelivr.net/gh/kossyak/iboxjs@latest/ibox.min.js"></script>
```
```javascript
// Wait for the connection to be established
const messenger = await ibox.client('https://parent-app.com')

// Listen for events from the parent
messenger.on('set_theme', (data) => {
    document.body.style.backgroundColor = data.color
})

// Send events to the parent
messenger.emit('request_data', { id: 123 })

// Cleanup when needed
// messenger.destroy()
```

---

## Request-Response Pattern (call)
In addition to standard event emitting, ibox supports a Promise-based RPC (Remote Procedure Call) pattern. This allows you to send a message and wait for a specific response from the other side.
1. Setup a Listener (Receiver)
   The side that receives the call must return a value (or a Promise) inside the on handler.
```javascript
   // Inside the Iframe (Client)
   messenger.on('get_user_name', async (userId) => {
       // You can perform async operations here
       const user = await db.find(userId)
       return user.name // This value will be sent back to the Host
   })
```

2. Make a Call (Sender)
   The side that initiates the request uses the call method, which returns a Promise.
```javascript
   // Inside the Main App (Host)
   try {
       // messenger.call(eventName, data, timeoutMs)
       const name = await messenger.call('get_user_name', 123)
       console.log('Received from iframe:', name)
   } catch (error) {
       // Handle timeout or connection errors
       console.error('Request failed:', error.message)
   }
````

### API Details for call:
messenger.call(event, data, timeout)
- event (string): The name of the event to trigger.
- data (any): Data to send to the listener.
- timeout (number, optional): Time in milliseconds to wait for a response before rejecting the promise. Default: 10000ms.

---

## Integration with JS Modules

If you are using `<script type="module">` for your application logic, global variables are not automatically scoped to the module. You should access the library via the `window` object:

```javascript
// Inside your report.js (type="module")
const messenger = window.ibox.host(iframe, 'https://child-app.com')
```
For standard scripts (without type="module"), you can continue using the shorthand:
```javascript
const messenger = ibox.host(iframe, 'https://child-app.com')
```

---

## Recommended Iframe Configuration
For maximum security and stability of your microservice, use the following attributes when defining your iframe. The ibox library requires at least allow-scripts to function.
```html
<iframe
    src="https://child-app.com"
    title="Microservice Name"
    
    /* Security: Essential for ibox to work safely */
    sandbox="allow-scripts allow-same-origin allow-forms"
    
    /* Permissions: Grant access to specific browser APIs if needed */
    allow="geolocation; camera; microphone"
    
    /* Privacy: Controls how much info is sent in the Referer header */
    referrerpolicy="strict-origin-when-cross-origin"
    
    /* Performance: Use 'eager' for immediate or 'lazy' for deferred loading */
    loading="eager"
    
    style="border: none; width: 100%; height: 500px;">
</iframe>
```

---

## API Reference
ibox.host(iframeElement, targetOrigin)

- **iframeElement:** The HTMLIFrameElement to communicate with.
- **targetOrigin:** The specific origin (e.g., https://example.com) of the iframe content.
- **Returns:** A Promise that resolves to an interface object.

ibox.client(hostOrigin)

- **hostOrigin:** The specific origin of the parent application.
- **Returns:** A Promise that resolves to an interface object.

### Handling Iframe Navigation

If you need to change the iframe source or reload it, you must destroy the old connection and establish a new one to ensure the secure channel is re-initialized correctly.

```javascript
// 1. Destroy the current connection
messenger.destroy()

// 2. Change the source
iframe.src = 'new-app-origin.com'

// 3. Re-initialize the host when needed
const newMessenger = await ibox.host(iframe, 'https://new-app-origin.com')
```

### Interface Methods:
- **on(event, callback):** Registers a listener for a specific event.
Returns: An unsubscription function. Calling this function will remove the listener.
```javascript
    const unsub = messenger.on('get_status', (data) => { ... });
    unsub() // Stop listening
```

- **off(event, callback):** Manually removes a previously registered event listener.
- **emit(event, data):** Sends a data payload to the other side without waiting for a response (Fire-and-forget).
- **call(event, data, timeout):** Sends a request and returns a Promise that resolves with the response from the other side.
  - event (string): Event name.
  - data (any): Payload to send.
  - timeout (number, optional): Timeout in milliseconds. Default: 10000ms.
  ```javascript
  const response = await messenger.call('fetch_user', { id: 1 })
  ```

- **destroy():** Immediately closes the MessagePort, rejects all pending calls, and clears all internal event handlers. Useful for memory management during iframe navigation or component unmounting.

---

## Security Best Practices
Always specify an explicit origin instead of *. This ensures that:

1. Your data is only sent to the intended recipient.
2. Your application only executes commands received from a trusted parent/child.
