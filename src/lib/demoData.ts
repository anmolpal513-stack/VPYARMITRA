import type { LedgerEntryRecord } from './finance';
import type { ShopProfileData } from './routeGuard';

export const DEMO_PROFILE: ShopProfileData = {
  uid: 'local-shopkeeper',
  shopName: 'शर्मा किराना स्टोर',
  ownerName: 'रमेश शर्मा',
  phone: '+919876543210',
  language: 'hi',
  onboarded: true,
  updatedAtIso: new Date().toISOString(),
};

function todayIsoAt(hours: number, minutes: number): string {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function daysAgoIso(daysAgo: number, hours: number, minutes: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export function createDemoLedgerEntries(): LedgerEntryRecord[] {
  return [
    // Today's confirmed sales (₹2,850 + ₹640.50 = ₹3,490.50)
    {
      id: 'entry-sale-today-1',
      ownerUid: 'local-shopkeeper',
      customerName: 'सुबह की नकद बिक्री',
      type: 'sale',
      amountPaise: 285000,
      note: 'दूध, ब्रेड, बिस्किट, किराना बिक्री',
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: todayIsoAt(9, 45),
    },
    {
      id: 'entry-sale-today-2',
      ownerUid: 'local-shopkeeper',
      customerName: 'दोपहर UPI बिक्री',
      type: 'sale',
      amountPaise: 64050,
      note: 'दाल, चावल और तेल',
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: todayIsoAt(13, 15),
    },
    // Today's confirmed expense (₹1,150)
    {
      id: 'entry-expense-today-1',
      ownerUid: 'local-shopkeeper',
      customerName: 'डेयरी और ब्रेड सप्लायर',
      type: 'expense',
      amountPaise: 115000,
      note: 'सुबह का स्टॉक भुगतान',
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: todayIsoAt(7, 30),
    },
    // Confirmed expense with MISSING amount -> triggers warning chip immediately!
    {
      id: 'entry-expense-missing-1',
      ownerUid: 'local-shopkeeper',
      customerName: 'थोक आटा बिल (रसीद फोटो)',
      type: 'expense',
      amountPaise: null,
      note: 'रसीद स्कैन से जुड़ी एंट्री — रकम लिखनी बाकी है',
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: todayIsoAt(11, 20),
    },
    // Pending Voice Sale (excluded from Today's Sales until confirmed!)
    {
      id: 'entry-ai-pending-sale-1',
      ownerUid: 'local-shopkeeper',
      customerName: 'शाम की बिक्री (आवाज़ एंट्री)',
      type: 'sale',
      amountPaise: 45000,
      note: 'बोलकर दर्ज बिक्री — कन्फर्म बाकी',
      source: 'voice',
      status: 'pending',
      occurredAtIso: todayIsoAt(16, 10),
      confidence: 0.64,
      transcript: 'शाम की बिक्री साढ़े चार सौ रुपये हुई शायद',
      uncertainFields: ['amount', 'type'],
    },
    // Pending Camera Bill Udhaar (clean — ready to confirm)
    {
      id: 'entry-ai-pending-1',
      ownerUid: 'local-shopkeeper',
      customerName: 'सुरेश गुप्ता',
      customerPhone: '+919811223344',
      type: 'udhaar',
      amountPaise: 34550,
      note: 'आटा 5kg, सरसों तेल 1L (कैमरा बिल स्कैन)',
      source: 'camera',
      status: 'pending',
      occurredAtIso: todayIsoAt(14, 15),
    },
    // Pending Camera Register Row with missing illegible amount (blocked until amount > 0)
    {
      id: 'entry-ai-pending-camera-missing-2',
      ownerUid: 'local-shopkeeper',
      customerName: 'मोहन डेयरी सप्लायर',
      type: 'expense',
      amountPaise: null,
      note: 'रजिस्टर पन्ने पर रकम धुंधली थी — कन्फर्म से पहले लिखें',
      source: 'camera',
      status: 'pending',
      occurredAtIso: todayIsoAt(14, 20),
      confidence: 0.58,
      uncertainFields: ['amount'],
    },
    // Confirmed Udhaar & Jama entries for credit ledger
    {
      id: 'entry-confirmed-1',
      ownerUid: 'local-shopkeeper',
      customerName: 'अनीता देवी',
      customerPhone: '+919822334455',
      type: 'udhaar',
      amountPaise: 125000,
      note: 'मासिक राशन — चावल 10kg, दाल 2kg, चाय पत्ती',
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: daysAgoIso(1, 16, 40),
    },
    {
      id: 'entry-confirmed-2',
      ownerUid: 'local-shopkeeper',
      customerName: 'राजेश वर्मा',
      customerPhone: '+919833445566',
      type: 'jama',
      amountPaise: 50000,
      note: 'नकद जमा',
      source: 'manual',
      status: 'confirmed',
      occurredAtIso: daysAgoIso(1, 11, 20),
    },
  ];
}

export const DEMO_LEDGER_ENTRIES: LedgerEntryRecord[] = createDemoLedgerEntries();
