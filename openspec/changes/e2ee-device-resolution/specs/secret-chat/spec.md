# secret-chat Specification (delta)

## ADDED Requirements

### Requirement: Sender caches peer sessions and roster; no per-send key fetch
The system SHALL cache, per peer, the established Double Ratchet sessions and a
snapshot of the peer's device roster. When sending a message for which a live cached
session to each known peer device already exists, the system SHALL NOT fetch the
peer's key bundle from the directory and SHALL NOT consume a one-time prekey. A
directory fetch (which consumes one OPK per device) SHALL occur only on a cache miss
or an explicit cache invalidation.

#### Scenario: Second and later messages reuse the cached session
- WHEN a sender sends a message to a peer it already has a cached session with
- THEN no `GET /key-directory/v1/keys/{peer}` request is made
- AND no one-time prekey is consumed
- AND the message is encrypted with the existing Double Ratchet session.

#### Scenario: First message establishes and caches the session
- WHEN a sender sends a first message to a peer with no cached session
- THEN it fetches the peer's bundle once (consuming one OPK per device)
- AND runs X3DH to establish the session
- AND caches the session and a roster snapshot for reuse.

### Requirement: Messages are encrypted to all currently-known peer devices
The system SHALL encrypt each message to every device in the cached roster for the
peer, producing one ciphertext per device in the envelope's `to` map, so that any
live device of the peer can decrypt.

#### Scenario: Single device
- WHEN the cached roster has one device
- THEN the envelope carries one ciphertext addressed to that device.

#### Scenario: Multiple known devices
- WHEN the cached roster has more than one device (e.g. after a rekey re-resolve)
- THEN the envelope carries one ciphertext per device
- AND each device decrypts only the ciphertext addressed to its own deviceId.

### Requirement: A device receiving a mis-addressed envelope emits a rekey hint
The system SHALL, when a device receives a secret envelope addressed to its user but
containing no ciphertext entry for its own deviceId, send the sender a metadata-only
rekey hint for that chat. The hint SHALL carry no key material and no device address —
only the chat/peer identity — and SHALL be coalesced so repeated mis-addressed
envelopes yield at most one hint per peer per burst.

#### Scenario: New device sees a message meant for the old device
- WHEN a user's newly-active device receives an envelope whose `to` map omits its deviceId
- THEN it does not attempt to decrypt another device's ciphertext
- AND it sends the sender a rekey hint naming the chat
- AND the hint contains no public key, prekey, or device identifier to be trusted.

#### Scenario: Repeated mis-addressed envelopes are coalesced
- WHEN several mis-addressed envelopes arrive in quick succession
- THEN at most one rekey hint per peer is sent for that burst.

### Requirement: Sender re-resolves and resends on a rekey hint
The system SHALL, on receiving a rekey hint from a peer, invalidate its cached roster
for that peer, re-fetch the roster from the directory bypassing the cache, establish
sessions to any new devices, encrypt to all now-known devices, and resend the affected
message(s). The system SHALL treat the hint only as a trigger to re-resolve from the
directory and SHALL NOT take any device identity from the hint itself.

#### Scenario: Peer switched devices
- WHEN a sender receives a rekey hint for a chat
- THEN it discards its cached roster for that peer
- AND fetches the current roster from the directory
- AND encrypts to every device now returned
- AND resends the message(s) that had been addressed to the stale device set.

#### Scenario: Spoofed hint cannot redirect to an attacker device
- WHEN a forged rekey hint is received
- THEN the sender only re-fetches from the auth-bound directory
- AND no attacker-supplied device or key is ever used
- AND the effect is bounded to one (rate-limited) re-fetch.

#### Scenario: Resend does not duplicate on a still-live old device
- WHEN the stale device was in fact still live and already received the original copy
- THEN durable dedup ensures the resent copy is not shown twice.

### Requirement: Cache invalidation triggers
The system SHALL invalidate its cached roster/sessions for a peer on any of: (a) a
rekey hint from that peer, (b) expiry of the roster snapshot TTL, (c) a local decrypt
failure of the peer's message indicating the peer's identity key changed.

#### Scenario: Roster snapshot expires
- WHEN the cached roster snapshot for a peer is older than the TTL
- THEN the next send re-fetches the roster before encrypting.

#### Scenario: Peer reinstalled (identity changed)
- WHEN a message from the peer fails to decrypt because its identity key changed
- THEN the stale session and cached identity are dropped
- AND the safety number is marked unverified
- AND the next send re-resolves and re-establishes the session.

### Requirement: Client publishes a reusable last-resort prekey
The client SHALL generate a dedicated last-resort one-time prekey at provisioning under a
reserved id, store its private half wrapped, and publish its public half. The prekey SHALL
be STABLE (generated once, not rotated) and SHALL remain reusable on the recipient side:
the local store SHALL NOT delete it when libsignal consumes a prekey (so it survives across
incoming prekey messages), and its reserved id SHALL NOT enter the monotonic one-time-prekey
id space. This lets a session to a peer whose normal pool is exhausted still complete X3DH
with a one-time-prekey slot filled, rather than degrading to signed-prekey-only. (A
never-rotated reusable key has weaker per-handshake forward secrecy — inherent to "last
resort"; rotation is avoided because a peer may hold the public between fetch and first use.)

#### Scenario: Establish a session against an exhausted peer pool
- WHEN a sender fetches a peer whose normal one-time-prekey pool is empty
- THEN the directory returns the peer's last-resort prekey
- AND X3DH proceeds using it as the one-time prekey
- AND the session is established (the safety floor is the same as signed-prekey-only).

#### Scenario: Last-resort key stays reusable across incoming sessions
- WHEN two different peers each establish a session using this device's last-resort prekey
- THEN both prekey messages decrypt (the private is not deleted after the first use)
- AND the reserved id never appears among newly-allocated one-time-prekey ids.

#### Scenario: Backfill for installs provisioned before the feature
- WHEN a device that has no stored last-resort prekey republishes on startup
- THEN it generates, stores, and publishes one.

### Requirement: One-time prekeys are replenished on demand, not only at startup
The client SHALL replenish its one-time-prekey pool whenever it observes its own
server-side remaining count at or below the low-water mark — checked periodically while
the app is active and after directory operations that report the count — not only at
app startup, so a fast drain is refilled without waiting for the next launch.

#### Scenario: Drain observed while active
- WHEN the client observes its remaining one-time-prekey count at or below the low-water
  mark while the app is running
- THEN it generates and publishes enough new one-time prekeys to reach the target.

#### Scenario: Pool healthy
- WHEN the observed remaining count is above the low-water mark
- THEN no replenishment is performed.
