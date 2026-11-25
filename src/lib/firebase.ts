import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type User,
  type ConfirmationResult,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  writeBatch,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  type FirebaseStorage,
} from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import type { AppLanguage } from './i18n';
import type {
  AuditEditableField,
  LedgerEntryRecord,
  LedgerEntryType,
  OriginalAIValueSnapshot,
  UncertainField,
} from './finance';
import type { ShopProfileData } from './routeGuard';
import { isSafeSourceImageUrl } from './photoExtraction';
import {
  validateShopName,
  validateOwnerName,
  validateAndNormalizeIndianPhone,
  sanitizeCustomerName,
  sanitizeNote,
} from './validation';

const app: FirebaseApp = initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth: Auth = getAuth(app);
export const storage: FirebaseStorage = getStorage(app);

/**
 * Uploads a client-compressed JPEG register/bill photo to Firebase Storage
 * under users/{uid}/register_photos/ and returns its HTTPS download URL.
 */
export async function uploadRegisterPhotoToStorage(
  uid: string,
  blob: Blob
): Promise<string> {
  const filename = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const fileRef = storageRef(storage, `users/${uid}/register_photos/${filename}`);
  await uploadBytes(fileRef, blob, {
    contentType: 'image/jpeg',
    cacheControl: 'private, max-age=31536000',
  });
  return getDownloadURL(fileRef);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function subscribeToAuth(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

let activeRecaptcha: RecaptchaVerifier | null = null;

export function clearRecaptchaVerifier(): void {
  if (activeRecaptcha) {
    try {
      activeRecaptcha.clear();
    } catch {
      // ignore cleanup issues
    }
    activeRecaptcha = null;
  }
}

/**
 * Initiates Firebase Auth Phone OTP verification using an invisible reCAPTCHA container.
 */
export async function sendPhoneOtp(
  phoneInput: string,
  recaptchaContainerId: string
): Promise<ConfirmationResult> {
  const phoneCheck = validateAndNormalizeIndianPhone(phoneInput);
  if (!phoneCheck.valid || !phoneCheck.sanitized) {
    throw new Error('INVALID_PHONE');
  }

  clearRecaptchaVerifier();
  activeRecaptcha = new RecaptchaVerifier(auth, recaptchaContainerId, {
    size: 'invisible',
  });

  return signInWithPhoneNumber(auth, phoneCheck.sanitized, activeRecaptcha);
}

/**
 * Reads users/{uid}/profile/main from Firestore.
 */
export async function fetchShopProfile(uid: string): Promise<ShopProfileData | null> {
  const profilePath = `users/${uid}/profile/main`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'profile', 'main'));
    if (!snap.exists()) {
      return null;
    }
    const data = snap.data();
    return {
      uid,
      shopName: typeof data.shopName === 'string' ? data.shopName : '',
      ownerName: typeof data.ownerName === 'string' ? data.ownerName : '',
      phone: typeof data.phone === 'string' ? data.phone : '',
      language: data.language === 'en' ? 'en' : 'hi',
      onboarded: Boolean(data.onboarded),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }
}

export interface SaveProfileInput {
  uid: string;
  shopName: string;
  ownerName?: string;
  phone?: string;
  language: AppLanguage;
  onboarded: boolean;
}

/**
 * Atomically writes parent users/{uid} and private users/{uid}/profile/main
 * adhering strictly to firebase-blueprint.json & firestore.rules constraints.
 */
export async function saveShopProfileToFirestore(input: SaveProfileInput): Promise<void> {
  const shopCheck = validateShopName(input.shopName);
  if (!shopCheck.valid) {
    throw new Error(shopCheck.errorKey ?? 'errShopNameRequired');
  }
  const ownerCheck = validateOwnerName(input.ownerName ?? '');
  if (!ownerCheck.valid) {
    throw new Error(ownerCheck.errorKey ?? 'errOwnerNameTooLong');
  }
  const phoneCheck = validateAndNormalizeIndianPhone(input.phone ?? '');
  if (!phoneCheck.valid) {
    throw new Error(phoneCheck.errorKey ?? 'errPhoneInvalid');
  }

  const userDocRef = doc(db, 'users', input.uid);
  const profileDocRef = doc(db, 'users', input.uid, 'profile', 'main');
  const profilePath = `users/${input.uid}/profile/main`;

  try {
    const existingProfileSnap = await getDoc(profileDocRef);
    const existingUserSnap = await getDoc(userDocRef);
    const batch = writeBatch(db);

    if (!existingUserSnap.exists()) {
      batch.set(userDocRef, {
        uid: input.uid,
        language: input.language,
        onboarded: input.onboarded,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(userDocRef, {
        language: input.language,
        onboarded: input.onboarded,
        updatedAt: serverTimestamp(),
      });
    }

    const profilePayload: Record<string, unknown> = {
      uid: input.uid,
      shopName: shopCheck.sanitized,
      ownerName: ownerCheck.sanitized,
      phone: phoneCheck.sanitized,
      language: input.language,
      onboarded: input.onboarded,
      updatedAt: serverTimestamp(),
    };

    if (!existingProfileSnap.exists()) {
      profilePayload.createdAt = serverTimestamp();
      batch.set(profileDocRef, profilePayload);
    } else {
      batch.update(profileDocRef, {
        shopName: shopCheck.sanitized,
        ownerName: ownerCheck.sanitized,
        phone: phoneCheck.sanitized,
        language: input.language,
        onboarded: input.onboarded,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }
}

export function subscribeToLedgerEntries(
  uid: string,
  onData: (entries: LedgerEntryRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/entries`;
  const q = query(
    collection(db, 'users', uid, 'entries'),
    where('ownerUid', '==', uid),
    orderBy('occurredAtIso', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const records: LedgerEntryRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const rawType = String(d.type ?? 'udhaar');
        const type =
          rawType === 'sale' || rawType === 'expense' || rawType === 'jama'
            ? rawType
            : 'udhaar';
        const rawSource = String(d.source ?? 'manual');
        const source =
          rawSource === 'ai' || rawSource === 'voice' || rawSource === 'camera'
            ? rawSource
            : 'manual';
        const rawAmount = d.amountPaise;
        const amountPaise =
          rawAmount === null || rawAmount === undefined
            ? null
            : Math.trunc(Number(rawAmount));

        const rawUncertain = Array.isArray(d.uncertainFields)
          ? (d.uncertainFields.filter(
              (f: unknown): f is UncertainField =>
                f === 'customerName' || f === 'amount' || f === 'type' || f === 'note'
            ) as UncertainField[])
          : undefined;

        const rawEdited = Array.isArray(d.editedFields)
          ? (d.editedFields.filter(
              (f: unknown): f is AuditEditableField =>
                f === 'customerName' || f === 'type' || f === 'amountPaise' || f === 'note'
            ) as AuditEditableField[])
          : undefined;

        let originalAIValue: OriginalAIValueSnapshot | undefined;
        if (d.originalAIValue && typeof d.originalAIValue === 'object') {
          const orig = d.originalAIValue as Record<string, unknown>;
          const origTypeRaw = String(orig.type ?? 'udhaar');
          const origType: LedgerEntryType =
            origTypeRaw === 'sale' || origTypeRaw === 'expense' || origTypeRaw === 'jama'
              ? origTypeRaw
              : 'udhaar';
          const origAmtRaw = orig.amountPaise;
          const origAmt =
            origAmtRaw === null || origAmtRaw === undefined
              ? null
              : Math.trunc(Number(origAmtRaw));
          originalAIValue = {
            customerName: typeof orig.customerName === 'string' ? orig.customerName : '',
            type: origType,
            amountPaise: origAmt !== null && Number.isFinite(origAmt) ? origAmt : null,
            note: typeof orig.note === 'string' ? orig.note : '',
          };
        }

        return {
          id: docSnap.id,
          ownerUid: String(d.ownerUid ?? uid),
          customerName: String(d.customerName ?? ''),
          customerPhone: typeof d.customerPhone === 'string' ? d.customerPhone : '',
          type,
          amountPaise: amountPaise !== null && Number.isFinite(amountPaise) ? amountPaise : null,
          note: typeof d.note === 'string' ? d.note : '',
          source,
          status: d.status === 'pending' ? 'pending' : 'confirmed',
          occurredAtIso:
            typeof d.occurredAtIso === 'string'
              ? d.occurredAtIso
              : new Date().toISOString(),
          confidence:
            typeof d.confidence === 'number' && Number.isFinite(d.confidence)
              ? d.confidence
              : undefined,
          transcript: typeof d.transcript === 'string' ? d.transcript : undefined,
          uncertainFields: rawUncertain && rawUncertain.length > 0 ? rawUncertain : undefined,
          sourceImageUrl:
            typeof d.sourceImageUrl === 'string' && isSafeSourceImageUrl(d.sourceImageUrl)
              ? d.sourceImageUrl
              : undefined,
          confirmedAt: typeof d.confirmedAt === 'string' ? d.confirmedAt : undefined,
          editedFields: rawEdited,
          originalAIValue,
        };
      });
      onData(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function createLedgerEntryInFirestore(
  uid: string,
  entry: Omit<LedgerEntryRecord, 'ownerUid'>
): Promise<void> {
  const path = `users/${uid}/entries/${entry.id}`;
  const customerCheck = sanitizeCustomerName(entry.customerName);
  if (!customerCheck.valid) {
    throw new Error(customerCheck.errorKey ?? 'errCustomerNameRequired');
  }
  const phoneCheck = validateAndNormalizeIndianPhone(entry.customerPhone ?? '');
  // Rule 2: Non-manual (AI/voice/camera) entries are ALWAYS saved strictly as pending
  const safeStatus = entry.source === 'manual' ? entry.status : 'pending';
  const safeAmount =
    entry.amountPaise === null
      ? entry.type === 'expense'
        ? null
        : 0
      : Math.trunc(entry.amountPaise);

  if (safeAmount !== null && (!Number.isSafeInteger(safeAmount) || safeAmount <= 0)) {
    throw new Error('errAmountInvalid');
  }

  const docData: Record<string, unknown> = {
    ownerUid: uid,
    customerName: customerCheck.sanitized,
    customerPhone: phoneCheck.valid ? phoneCheck.sanitized : '',
    type: entry.type,
    amountPaise: safeAmount,
    note: sanitizeNote(entry.note ?? ''),
    source: entry.source,
    status: safeStatus,
    occurredAtIso: entry.occurredAtIso,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (
    typeof entry.confidence === 'number' &&
    Number.isFinite(entry.confidence) &&
    entry.confidence >= 0 &&
    entry.confidence <= 1
  ) {
    docData.confidence = entry.confidence;
  }
  if (typeof entry.transcript === 'string' && entry.transcript.trim().length > 0) {
    docData.transcript = entry.transcript.trim().slice(0, 500);
  }
  if (Array.isArray(entry.uncertainFields)) {
    docData.uncertainFields = entry.uncertainFields.slice(0, 4);
  }
  if (isSafeSourceImageUrl(entry.sourceImageUrl)) {
    docData.sourceImageUrl = entry.sourceImageUrl!.trim().slice(0, 1024);
  }

  try {
    await setDoc(doc(db, 'users', uid, 'entries', entry.id), docData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export interface ConfirmEntryOverrides {
  customerName?: string;
  type?: LedgerEntryType;
  amountPaise: number;
  note?: string;
  confirmedAt: string;
  editedFields: AuditEditableField[];
  originalAIValue: OriginalAIValueSnapshot;
}

export async function confirmPendingEntryInFirestore(
  uid: string,
  entryId: string,
  overrides: ConfirmEntryOverrides
): Promise<void> {
  const path = `users/${uid}/entries/${entryId}`;
  const safeAmount = Math.trunc(overrides.amountPaise);
  if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
    throw new Error('errAmountInvalid');
  }

  try {
    const payload: Record<string, unknown> = {
      status: 'confirmed',
      uncertainFields: [],
      amountPaise: safeAmount,
      confirmedAt: overrides.confirmedAt,
      editedFields: overrides.editedFields.slice(0, 4),
      originalAIValue: {
        customerName: overrides.originalAIValue.customerName.trim().slice(0, 60),
        type: overrides.originalAIValue.type,
        amountPaise:
          overrides.originalAIValue.amountPaise !== null &&
          Number.isSafeInteger(overrides.originalAIValue.amountPaise) &&
          overrides.originalAIValue.amountPaise > 0
            ? overrides.originalAIValue.amountPaise
            : null,
        note: (overrides.originalAIValue.note ?? '').trim().slice(0, 140),
      },
      updatedAt: serverTimestamp(),
    };
    if (overrides.customerName !== undefined) {
      const check = sanitizeCustomerName(overrides.customerName);
      if (!check.valid) throw new Error(check.errorKey ?? 'errCustomerNameRequired');
      payload.customerName = check.sanitized;
    }
    if (overrides.type !== undefined) {
      payload.type = overrides.type;
    }
    if (overrides.note !== undefined) {
      payload.note = sanitizeNote(overrides.note);
    }
    await updateDoc(doc(db, 'users', uid, 'entries', entryId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateMissingExpenseAmountInFirestore(
  uid: string,
  entryId: string,
  amountPaise: number
): Promise<void> {
  const path = `users/${uid}/entries/${entryId}`;
  const safeAmount = Math.trunc(amountPaise);
  if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
    throw new Error('errAmountInvalid');
  }
  try {
    await updateDoc(doc(db, 'users', uid, 'entries', entryId), {
      amountPaise: safeAmount,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteLedgerEntryInFirestore(uid: string, entryId: string): Promise<void> {
  const path = `users/${uid}/entries/${entryId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'entries', entryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
