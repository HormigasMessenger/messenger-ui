# calls Specification (delta)

## ADDED Requirements

### Requirement: Call signaling SDP is end-to-end authenticated
The system SHALL exchange the WebRTC SDP offer and answer for a 1:1 call inside the peers'
established Signal E2EE session, so the messenger server relays only ciphertext and cannot
read or modify the `a=fingerprint` that anchors the DTLS handshake. The system SHALL apply
this identically to audio and video calls (a single PeerConnection / DTLS session covers
all tracks).

#### Scenario: Offer and answer travel as ciphertext
- WHEN a caller creates an SDP offer for a peer
- THEN the offer is encrypted with the Signal session to that peer before it is sent
- AND the `call:offer` frame on the wire contains only the ciphertext, no plaintext SDP
- AND the callee decrypts it with the Signal session before `setRemoteDescription`
- AND the callee's SDP answer is likewise encrypted before it is sent back.

#### Scenario: Server cannot MITM the DTLS handshake
- WHEN the messenger server alters or substitutes the encrypted `call:offer`/`call:answer`
- THEN decryption fails the AEAD authentication check on the receiving client
- AND the altered SDP is never applied to the PeerConnection.

### Requirement: Fail closed with no downgrade path
The system SHALL refuse to place or accept a call whose SDP cannot be end-to-end wrapped,
rather than fall back to plaintext signaling. There SHALL be no code path that sends or
accepts a plaintext SDP offer/answer.

#### Scenario: Peer has no keys
- WHEN a caller tries to call a peer that has published no E2EE keys
- THEN encrypting the offer fails
- AND the call is ended and the user is told the peer hasn't enabled encryption
- AND no `call:offer` carrying a plaintext SDP is sent.

#### Scenario: Tampered or undecryptable inbound SDP
- WHEN an inbound `call:offer` or `call:answer` cannot be decrypted
- THEN the SDP is NOT passed to `setRemoteDescription`
- AND the call is rejected/ended.

### Requirement: Verified-peer indication
The system SHALL indicate on the active call when the peer's identity is already verified
(the peer's stored safety number matches the current one), reusing the chat verification
state.

#### Scenario: Verified peer
- WHEN a call is active with a peer whose safety number is verified
- THEN the call UI shows a "verified" indicator.

#### Scenario: Unverified peer
- WHEN the peer's safety number is not verified
- THEN no verified indicator is shown (the call is still E2EE-authenticated; the indicator
  only reflects the out-of-band identity check).
