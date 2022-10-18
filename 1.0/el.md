# EL: Encrypt Locally

[![License](https://img.shields.io/badge/license-MIT-a1356a)](../LICENSE.txt) ![Version: 1.0](https://img.shields.io/badge/Version-1.0-blue) ![Status: Draft](https://img.shields.io/badge/Draft-Status-orange)

## Storage

Storing information on a user's device, via various Web Platform APIs, requires careful consideration.

Different types of application information need to persist for different amounts of time. For example, the application may have the notion of a "session", which only stores some of its information for as long as that application instance/window is open. By contrast, a user's personal data likely should persist indefinitely.

### Session Information

The `sessionStorage` API seems ideal for storing information that should only exist for that session. However, this API is not ideal for a number of reasons.

First, it's a synchronous API, meaning that it blocks the main thread while being read. Rarely does that become a problem, but in some cases, it could be an issue. Moreover, some browsers may persist information from `sessionStorage` in places on disk that are easy to access or spy on by outside processes. Also, `sessionStorage` (and `localStorage`) are not available in Workers (including Service Workers).

For these reasons, it's best to avoid much reliance on `sessionStorage`. To track session based information, the process that should be followed at application opening/initialization (page-load) is:

1. Check `sessionStorage` for a session identifier stored in a predictable key, such as `session-id`.

2. If not present, use `crypto.getRandomValues()` to randomly generate a string of base-64 characters that's at least 16 characters in length. Store this value in the predictable (e.g., `session-id`) key in `sessionStorage`.

3. With this value, look for the corresponding entry in [the persistent storage](#persistent-information) at the same key. This entry should be a JSON object that look like this:

    ```json
    {
        "iv": "...",
        "encrypted": "..."
    }
    ```

4. The `iv` will hold a base-64 encoded string representation of the *iv* (initilization vector) random data that was used, along with the `session-id` as key, to encrypt the data stored in `encrypted`.

5. The key data is imported with `crypto.subtle.importKey(..)`, using `"AES-GCM"` as the algorithm. This key data is then used to encrypt/decrypt any intended session data (in a stringified JSON object) via `crypto.subtle.encrypt(..)` / `crypto.subtle.decrypt(..)`, respectively.

    The options object passed to either method should specify the `"AES-GCM"` algorithm, at a minimum like this:

    ```js
    cryptoOptions = {
        name: "AES-GCM",
    };
    ```

6. Once decrypted, session data may then be stored/accessed "in memory" in a non-global variable holding the object, for the duration of that page instance. Any changes to this session information must be re-encrypted using the `iv` and `session-id` (same process as above) and re-stored in the corresponding `IndexedDB` entry.

7. An application should ideally clean up after itself. If `IndexedDB` is holding other session entries that don't match the current `session-id`, those should be deleted to free up device memory.

### Persistent Information

Because the `localStorage` API suffers the same problems as the `sessionStorage` API (with less advantages), it should be avoided entirely.

Instead, persistent data should be stored in `IndexedDB`. The [idb-keyval package](https://www.npmjs.com/package/idb-keyval) provides an nice interface for storing key-value pairs of data, including JSON objects, in `IndexedDB`.

In addition, the application should request an elevation of storage persistence via the [Persistent Storage API](https://web.dev/persistent-storage/).

There are, however, several UX concerns to be aware of with this API. Some browsers/devices will cause a prompt to popup for a user. This would be jarring to a user if they received this prompt out of context (especially at the first time they ran an application).

As such, the application should detect if it doesn't already have this elevated storage persistence, and gracefully message to the user why it needs to ask for this -- to ensure the best level of protection of their local device-only data. The message should let the user know they may receive a confirmation prompt, and  present a button or action that the user initiates, which then initiates the request for the elevated storage persistence.

Since this permission is not necessarily permanent (can be reset or revoked, by the user), the application must do this check every time, and be prepared to re-prompt the user if it detects that storage persistence is not currently elevated.

## Secret Passphrase

Aside from encryped session information (as described above), any other data that the application stores on behalf of the user, must be encrypted as stored.

To encrypt and then decrypt this data, the user must be prompted to set a unique secret passphrase (for example, a [Diceware passphrase](https://diceware.dmuth.org/)). The minimum requirements for the passphrase must *at least* be 10 characters in length, with at least 2 spaces (three words).

To aid the user in selecting a secure but memorable passphrase that protects their private data, the application should offer the capability to generate random passphrase suggestions that the user can pick from. Alternately, the user can be directed to use any of several online password/passphrase generation tools, such as [Secure Phrase](https://securephrase.io).

The user's chosen secret passphrase is used to derive the AES-GCM symmetric encryption/decryption key used to protect their data. The derivation algorithm is Argon2-ID. A port of this algorithm is available via WASM module from the [hash-wasm package](https://www.npmjs.com/package/hash-wasm).

Since password hashing (key derivation) is *supposed to* take some time (say, 0.5 seconds) to be more secure, this Argon2-ID module should be used from a web worker, to keep from blocking the application's main thread for that time.

The recommended Argon2-ID parameters are:

```js
argonDefaultOptions = {
    iterations: 100,
    parallelism: 1,
    memorySize: 1024,
    hashLength: 32,
    outputType: "encoded",
};
```

You will also need to generate a 32-byte random salt value for the hashing. This salt must be stored in the persistent storage along with the data, so that the decryption key can later be re-derived from the user's secret passphrase.

### Secret Challenge

Since decrypting a large chunk of stored data can chew up a device's CPU/memory, perhaps only to fail if the secret passphrase was entered incorrectly, a shorter checksum challenge value can be generated and stored, alongside the data, to verify if the secret passphrase is correct, before attempting a more costly decryption.

The secret challenge is generated via Argon2-ID hashing (with the same parameters), using the user's secret key as the **salt** and the password being a fixed constant string defined in the application, such as `"myApp: secret challenge"`.

Regenerating a secret challenge from the user's entered password should match the stored secret challenge, and if so, then it's safe to attempt the full data decryption. Otherwise, the user can be notified their entered secret passphrase does not match.

## Encrypting / Decrypting User Data

Each time the user's data is set/updated, a new `iv` (random initialization vector) must be generated. The user's passphrase-derived encryption/decryption key plus the `iv` will be used with `crypto.subtle.encrypt(..)` / `crypto.subtle.decrypt(..)`, with the `"AES-GCM"` algorithm.

The data itself can be whatever the application wants to store. It should be a string of JSON representing an object. The application may keep this data "in memory" in a non-global variable. Any changes to the user's data must be immediately re-encrypted and persisted to the `IndexedDB` key/val store.
