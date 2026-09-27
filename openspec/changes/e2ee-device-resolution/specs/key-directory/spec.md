# key-directory Specification (delta)

## ADDED Requirements

### Requirement: Fetch serves all of a peer's live devices
The directory SHALL, on a user-scoped fetch, return the bundle of every one of the
user's stored devices (one one-time prekey consumed per device), so the sender can
encrypt to all of them. Publishing a device SHALL NOT retire the user's other devices.

#### Scenario: Multi-device fetch
- WHEN a caller fetches `GET /v1/keys/{userId}` for a user with two devices
- THEN the response contains a bundle for each device
- AND one one-time prekey is consumed per device (null when a pool is exhausted).

### Requirement: Stale-device GC keeps the newest and never orphans a user
The directory SHALL periodically prune a device only when it is older than the device
TTL AND the same user has a newer device (keep-newest). A user's single, most-recent
device SHALL never be pruned, so a first contact always finds at least one bundle.

#### Scenario: Superseded device ages out
- WHEN a user has a newer device and an older one untouched for longer than the TTL
- THEN the older device is pruned
- AND the newer device remains.

#### Scenario: Single dormant device is kept
- WHEN a user has exactly one device, untouched for longer than the TTL
- THEN it is NOT pruned (the user stays reachable for a first contact).

## MODIFIED Requirements

### Requirement: Device time-to-live is 60 days
The directory's stale-device TTL SHALL default to 60 days (`KD_DEVICE_TTL_DAYS=60`),
after which a superseded device (one with a newer sibling) becomes eligible for GC.
Live devices are kept fresh by the client's touch-on-start publish, so only genuinely
abandoned devices age out.

#### Scenario: TTL configuration
- WHEN `KD_DEVICE_TTL_DAYS` is unset
- THEN the effective device TTL is 60 days
- AND `KD_DEVICE_TTL_DAYS=0` disables the sweep.

## ADDED Requirements

### Requirement: Last-resort prekey served on pool exhaustion
The directory SHALL accept and store a per-device reusable last-resort prekey, and
SHALL serve it as the fetched `oneTimePreKey` — WITHOUT consuming it — when the
device's normal one-time-prekey pool is exhausted. When the normal pool is non-empty
the directory SHALL serve (and consume) a normal one-time prekey, preferring the pool
over the last-resort key. A publish MAY update the last-resort key (rotation); it SHALL
NOT be counted toward the consumable pool's remaining count.

#### Scenario: Normal pool has keys
- WHEN a device's one-time-prekey pool is non-empty
- THEN a fetch serves and consumes the lowest-id normal one-time prekey
- AND the last-resort key is not served.

#### Scenario: Pool exhausted, last-resort present
- WHEN a device's normal pool is empty and a last-resort key is published
- THEN a fetch serves the last-resort key as `oneTimePreKey`
- AND does NOT consume it (subsequent fetches keep serving it until the pool refills)
- AND the response marks it as a last-resort key (`oneTimePreKeyIsLastResort: true`).

#### Scenario: Pool exhausted, no last-resort
- WHEN a device's normal pool is empty and no last-resort key was published
- THEN `oneTimePreKey` is null (X3DH falls back to signed-prekey only, unchanged).
