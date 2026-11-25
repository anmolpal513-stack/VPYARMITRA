# VyaparMitra Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Ownership & PII Isolation**: `users/{uid}`, `users/{uid}/profile/{profileId}`, and `users/{uid}/entries/{entryId}` are strictly private to the authenticated, verified owner (`request.auth.uid == uid`). No cross-user reads, lists, or writes are permitted.
2. **Master Gate**: Subcollection documents under `/users/{uid}/profile/{profileId}` and `/users/{uid}/entries/{entryId}` require the parent `/users/{uid}` document to exist (via `exists(...)` or `existsAfter(...)` for atomic batch creation).
3. **Profile Validation**: `shopName` must be a string between 2 and 50 characters; `language` must be `"hi"` or `"en"`; `onboarded` must be boolean; optional `ownerName` <= 50 chars; optional `phone` matches `^(\+?[0-9]{10,15})?$`.
4. **AI Entry Pending Rule**: Any `LedgerEntry` with `source == "ai"` MUST be created with `status == "pending"`. Transition to `status == "confirmed"` requires an explicit `update` action by the owner, and once `confirmed`, status is terminal and cannot revert to `pending`.
5. **Paise Integer Integrity**: `amountPaise` must be a positive integer (`is int && > 0 && <= 10000000000`).
6. **Temporal & Immutability Integrity**: `createdAt == request.time` on create; `updatedAt == request.time` on create & update; `uid` / `ownerUid` and `createdAt` are immutable on update.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Cross-User Profile Read**: User B (`uid_b`) attempts `get` on `/users/uid_a/profile/main`.
2. **Shadow Field Injection on Profile Create**: Owner sends extra ghost field `isAdmin: true` to `/users/uid_a/profile/main`.
3. **Shop Name Too Short**: Owner creates profile with `shopName: "A"` (1 char < 2 min).
4. **Shop Name Overflow (DoW)**: Owner creates profile with 120-character `shopName` (> 50 max).
5. **Invalid Language Enum**: Owner sets `language: "fr"` instead of `"hi"` or `"en"`.
6. **Identity Spoofing on Entry Create**: User A sets `ownerUid: "uid_b"` inside `/users/uid_a/entries/e1`.
7. **AI Entry State Shortcutting**: Owner creates entry with `source: "ai"` and `status: "confirmed"` (bypassing `"pending"`).
8. **Terminal Status Reversal**: Owner updates an already `"confirmed"` entry back to `status: "pending"`.
9. **Float Amount Poisoning**: Owner creates entry with `amountPaise: 12.5` (non-integer float) or `amountPaise: -500`.
10. **Client Timestamp Forgery**: Owner sends custom `createdAt` instead of `serverTimestamp()` (`request.time`).
11. **Path ID Poisoning**: Owner writes to `/users/uid_a/entries/bad$id!with/spaces` or a 200-char ID.
12. **Unverified / Unauthenticated Access**: Unauthenticated request or user without `email_verified == true` and without `phone_number != null` attempts write.
