# EL: Encrypt Locally

[![License](https://img.shields.io/badge/license-MIT-a1356a)](../LICENSE.txt) ![Version: 1.0](https://img.shields.io/badge/Version-1.0-blue) ![Status: Draft](https://img.shields.io/badge/Draft-Status-orange)

This section of the EL/ASI specification deals with the importance of storing user data locally on their device. Keeping user data safe, private, and secure, is of utmost importance.

The **EL** standard here lays out how, with standard web technology and APIs, we ensure an encrypted data store on the user's device, one which can run completely offline (no internet) and thus has zero reliance on servers.

## JSON, Base64, UTF-8, Binary

The following algorithms make heavy reference to terms "Base64". But the hashing/encryption/decryption APIs all use binary data. JS strings also hold underlying UTF-16 (double UTF-8) character data that must be preserved. And application data is typically held in objects, but only strings can be encrypted/decrypted.

To encode a JS object as a JSON string, use `JSON.stringify(..)`. To decode a string back to a JS object, use `JSON.parse(..)`.

When you have binary data, such as the randomly generated *iv* (initialization vector) data (in an `ArrayBuffer`) or the derived key in its binary form, and you need to store value that in a JSON string, you need to encode that binary data as Base64.

The application should use a package like [base64-arraybuffer](https://www.npmjs.com/package/base64-arraybuffer) for this conversion, with the `encode(..)` method. To go the other direction, from Base64 back to a binary `ArrayBuffer`, use `decode(..)`.

When you have a plain-text (non-encrypted) string, such as the user's secret passphrase or the JSON string of user data, and you need a binary representation for an API, care must be taken to ensure the binary UTF-8 bytes are extracted from the string. To do so, use the built-in utility `(new TextEncoder()).encode(..)`. To go from binary back to a JS string, use `(new TextDecoder()).decode(..)`.

## Storage

Storing information on a user's device, via various Web Platform APIs, requires careful consideration.

Different types of application information need to persist for different amounts of time. For example, the application may have the notion of a "session", which only stores some of its information for as long as that application instance/window is open. By contrast, a user's personal data likely should persist indefinitely.

### Session Information

The `sessionStorage` API seems ideal for storing information that should only exist for that session. However, this API is not ideal for a number of reasons.

First, it's a synchronous API, meaning that it blocks the main thread while being read. Rarely does that become a problem, but in some cases, it could be an issue. Moreover, some browsers may persist information from `sessionStorage` in places on disk that are easy to access or spy on by outside processes. Also, `sessionStorage` (and `localStorage`) are not available in Workers (including Service Workers).

For these reasons, it's best to avoid much reliance on `sessionStorage`. To track session based information, the process that should be followed at application opening/initialization (page-load) is:

1. Check `sessionStorage` for a session identifier stored in a predictable key, such as `session-id`.

2. If not present, use `crypto.getRandomValues()` to randomly generate a string of Base64 characters that's at least 16 characters in length. Store this value in the predictable (e.g., `session-id`) key in `sessionStorage`.

3. With this value, look for the corresponding entry in [the persistent storage](#persistent-information), with a predictable name such as `session-info`. This entry should be a JSON object that looks like this:

    ```json
    {
        "iv": "...",
        "encrypted": "..."
    }
    ```

4. The `iv` will hold a Base64 encoded string representation of the *iv* (initilization vector) random data that was used, along with the `session-id` as key, to encrypt the data stored in `encrypted`.

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

To encrypt and then decrypt this data, the user must be prompted during "registration" of their local account, to set a unique secret passphrase (for example, a [Diceware passphrase](https://diceware.dmuth.org/)). The minimum requirements for the passphrase must *at least* be 10 characters in length, with at least 2 spaces (three distinct "words").

**Note:** The plain (unhashed or unencrypted) text of a user's secret passphrase **must never** be stored anywhere other than "in memory" (in a non-global variable). It must not even remain in a live DOM `<input type=password>` element -- the element must be removed from the DOM or its `value` set to `""`.

To aid the user in selecting a secure but memorable passphrase that protects their private data, the application should offer the capability to generate random passphrase suggestions that the user can pick from. Alternately, the user can be directed to use any of several online password/passphrase generation tools, such as [Secure Phrase](https://securephrase.io).

The user's chosen secret passphrase is used to derive the AES-GCM symmetric encryption/decryption key used to protect their data. The derivation hashing algorithm must be Argon2-ID. A port to WASM of this algorithm is available via the [hash-wasm package](https://www.npmjs.com/package/hash-wasm).

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

Since password hashing (key derivation) is *supposed to* take some time (say, 0.5 seconds), to be more secure, the Argon2-ID module must be used from a web worker, to keep from blocking the application's main thread for that time.

You will need to generate a 32-byte random salt value (using `crypto.getRandomValues()`) for the hashing key derivation. This salt must be stored in the persistent storage along with the data, so that the decryption key can later be re-derived from the user's secret passphrase.

### Handling The Derived Key

The application is allowed to choose -- and indeed, even let the user choose, with appropriate communication about the details of this choice -- one of the 4 following processes for handling the derived encryption/decryption key:

1. The application may store this key **only** "in memory" (non-global variable).

    Additionally, the application may track with a timer (either reset by user activity or not) to clear/forget this in-memory storage of the key (and data, of course), requiring the user to be re-prompted for their secure passphrase the next time their data must be encrypted/decrypted.

    The timer interval length is at the discretion of the application (and/or the user), but should never be shorter than 5 minutes.

    This is the most secure method, but also quite inconvenient for the user. In addition to the time interval resets, each time a page load/reload occurs, the user will have to be re-prompted for their secure passphrase.

    If the application's data storage is particularly sensitive (legally, socially, etc), this process may be appropriate. But it should be considered that users generally maintain good physical security of their own personal devices, so it may be overkill.

    If the user is annoyed by such inconvenience, they may respond by choosing a less secure passphrase (e.g., 10 of the same character, etc), storing it unprotected on their device, or even writing it down. This defeats the whole purpose of the security. A careful balance must be determined.

2. Like (1), the application may store the key **only** "in memory" (non-global variable), but without the timer interval reset.

    This is slightly more convenient for the user, but still might be too much of a burden. Care must be exercised in making such decisions.

3. The application may store this key -- again, NOT the plain-text of the passphrase! -- inside the encrypted session-info storage. This is in addition to storing it "in memory" (non-global variable).

    Since the session storage is tied to an instance of the tab/window of the application, a user logs in (inputs their secret passphrase) just once per session.

    This is much more convenient for the user, and matches what most users are used to with normal websites/web applications. This is the recommended level of security/privacy protection.

4. The application may store this key in the persistent storage, effectively giving the user a "permanent login" that spans multiple sessions (opening, closing the app). Optionally, the application can track a timestamp and skip using the stored key after a certain amount of time (e.g., 60 days), requiring a "re-login".

    This process more closely matches what most users expect from many typical native apps, where the app holds their session open indefinitely (or at least for long periods of time). It's also the least secure.

    The application must give the user an option to "forget" (aka, logout) this persistent storage of their key, such that they will have to be prompted for the secure passphrase again.

    **Note:** It may seem that this option moots all the encryption processes, and the application could just store everything unencrypted. **This is not allowed.** At a minimum, encryption strengthens the app from passive memory surveying, by never storing the data unencrypted (requires analyzing the app to decrypt). Moreover, it should be trivial for the user's "logout" by deleting the key, even if done outside the app, rather than the app having to then re-encrypt everything.

### Secret Challenge

Since decrypting a large chunk of stored data can chew up a device's CPU/memory, perhaps only to fail if the secret passphrase was entered incorrectly, a shorter checksum challenge value should be generated and stored, alongside the data, to verify if the secret passphrase is correct, before attempting a more costly decryption.

The secret challenge is also generated via Argon2-ID hashing (with the same parameters), using the user's secret passphrase as the **salt** and the **password** being a fixed constant string defined in the application, such as `"myApp: secret challenge"`.

Regenerating a secret challenge from the user's entered passphrase should match this stored secret challenge, and if so, then it's safe to attempt the full data decryption. Otherwise, the user can be notified their entered secret passphrase does not match (and that decryption would fail).

### Changing The Passphrase

Applications must support the user changing their secret passphrase.

Since the passphrase is the source of the encryption key, the user must first input the current passphrase (allowing decryption).

Before re-encryption of the decrypted user data, the application must regenerate a new salt to use for the new hash key derivation, and must also update the secret challenge (using the new salt).

### Passphrase Reset

Applications are **allowed** to offer a remote backup of the encryption key (and *iv*), which facilitates the possibility for a passhrase reset if the user forgets their passphrase.

The application must generate/use a cross-device identifier to uniquely identify the user's account, so the user is able to properly retrieve this encryption key/iv.

Applications must never remotely store the user's passphrase (nor the hash salt).

Applications must never remotely store both the user's encryption key/iv *and* their encrypted data -- that is, applications must choose storing one or the other, never both.

## Encrypting / Decrypting User Data

Each time the user's data is set/updated, a new `iv` (random initialization vector) must be generated. The user's passphrase-derived encryption/decryption key plus the `iv` will be used with `crypto.subtle.encrypt(..)` / `crypto.subtle.decrypt(..)`, and the `"AES-GCM"` algorithm.

The user data can be whatever the application wants to store on the user's behalf. You encrypt a string of JSON representing an object holding this information.

The application may also keep this object data "in memory" in a non-global variable for convenience, but will need to re-fetch and decrypt it on each page load. Any changes to the user's data must be immediately re-encrypted and persisted to the `IndexedDB` key/val store.

## Multiple Accounts

An application may choose to let users register multiple local accounts, each with its own secret passphrase.

To keep all the data needed for each account separate, the application must prompt the user for a friendly label/name (akin to a "username" in a traditional web-based login system).

These values are stored in plain-text (not encrypted), so it's important the user know that what they enter for this account-label/account-name is "public" (only on their device, of course), rather than private.

To prevent ambiguity, the application should never allow duplicate accounts with the same label.

### Deleting Accounts

Deleting local accounts, if supported, is up to the application to determine (not controlled by this specification).

Some applications may want to require the correct passphrase to delete the account. Other applications may allow deleting the account without such a passphrase (in case the user forgot it).

Some applications may even offer advanced features for additional security. For example, a "deadman's switch" feature that deletes an account if the user hasn't logged in successfully frequently enough. Another option: offering a "kill switch" password, where if entered, actually deletes an account instead of decrypting it.

All of these decisions are up to each application. Careful concern for the UX implications should be exercised, including proper configuration options (opt-in, opt-out) and messaging to explain the expected behaviors.

## Example Data Storage

Here's an example of what all the information implied by the **EL** standard might look like, stored together (again, in an `IndexedDB` keyval store):

```json
{
    "session-info": {
        "iv": "GjZ9...gXwf",
        "encrypted": "c01b...9/8="
    },
    "keyInfo": {
        "algorithm": "argon2id",
        "params": {
            "m": 1024,
            "t": 100,
            "p": 1
        },
        "salt": "SzMF...BMV8",
        "version": 19
    },
    "secretChallenge": "8ac8...f533",
    "iv": "TA2N...MA==",
    "encrypted": "c/XL...cZzK"
}
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
