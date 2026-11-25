import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('firestore.rules enforces Eight Pillars and Dirty Dozen invariants', () => {
  const rules = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  // Pillar 0: Default deny safety net
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/);

  // Pillar 1 & 6: Master Gate + PII Isolation on profile subcollection
  assert.match(rules, /match \/users\/\{uid\}/);
  assert.match(rules, /match \/profile\/\{profileId\}/);
  assert.match(rules, /match \/entries\/\{entryId\}/);
  assert.match(rules, /function hasParentUser\(uid\)/);

  // Pillar 2: Validation blueprints called on create & update + shopName 2-50 bounds synced with blueprint
  assert.equal(blueprint.entities.ShopProfile.properties.shopName.minLength, 2);
  assert.equal(blueprint.entities.ShopProfile.properties.shopName.maxLength, 50);
  assert.match(rules, /data\.shopName\.size\(\) >= 2 && data\.shopName\.size\(\) <= 50/);

  // Pillar 3: Path ID hardening
  assert.match(rules, /function isValidId\(id\)/);

  // Non-negotiable Rule 2: AI entries must start as pending & confirmed is terminal
  assert.match(rules, /incoming\(\)\.source == 'manual' \|\| incoming\(\)\.status == 'pending'/);
  assert.match(rules, /!\(existing\(\)\.status == 'confirmed' && incoming\(\)\.status != 'confirmed'\)/);

  // Non-negotiable Rule 4: Integer paise check (with nullable amountPaise strictly for expenses)
  assert.match(rules, /function isValidEntryAmount\(data\)/);
  assert.match(rules, /data\.amountPaise is int && data\.amountPaise > 0/);
  assert.match(rules, /data\.type == 'expense' && data\.amountPaise == null/);

  // Pillar 8: Secure list query evaluates resource.data.ownerUid
  assert.match(rules, /allow list: if isOwner\(uid\) && resource\.data\.ownerUid == request\.auth\.uid;/);

  // Voice & Photo extraction metadata + Pillar 5 bounded array guarding
  assert.match(rules, /data\.transcript\.size\(\) <= 500/);
  assert.match(rules, /data\.uncertainFields is list && data\.uncertainFields\.size\(\) <= 4/);
  assert.match(rules, /data\.sourceImageUrl\.size\(\) <= 1024 && data\.sourceImageUrl\.matches/);

  // Confirmation finality: block missing/<=0 amount on pending->confirmed & enforce immutable audit trail
  assert.match(rules, /function isValidOriginalAIValue\(val\)/);
  assert.match(
    rules,
    /existing\(\)\.status == 'pending'[\s\S]*incoming\(\)\.status == 'confirmed'[\s\S]*incoming\(\)\.amountPaise is int && incoming\(\)\.amountPaise > 0/
  );
  assert.match(rules, /'confirmedAt' in incoming\(\)/);
  assert.match(rules, /'editedFields' in incoming\(\)/);
  assert.match(rules, /'originalAIValue' in incoming\(\)/);
  assert.match(
    rules,
    /\(!\('confirmedAt' in existing\(\)\) \|\| incoming\(\)\.confirmedAt == existing\(\)\.confirmedAt\)/
  );
  assert.match(
    rules,
    /\(!\('originalAIValue' in existing\(\)\) \|\| incoming\(\)\.originalAIValue == existing\(\)\.originalAIValue\)/
  );

  // Sync blueprint audit fields with rules
  assert.ok(blueprint.entities.LedgerEntry.properties.confirmedAt);
  assert.ok(blueprint.entities.LedgerEntry.properties.editedFields);
  assert.ok(blueprint.entities.LedgerEntry.properties.originalAIValue);

  // Strict server timestamps & verified user gate
  assert.match(rules, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
});
