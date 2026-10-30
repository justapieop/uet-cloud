import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidDomainParams, Volume, type VolumeDetails } from "../dist/index.js";

const VALID_DETAILS: VolumeDetails = {
  id: "vol-001",
  userId: "user-123",
  name: "data-volume",
  sizeGb: 10,
  region: "eastus2",
};

test("Volume constructs and exposes properties when valid", (): void => {
  const volume: Volume = new Volume(VALID_DETAILS);
  assert.equal(volume.id, "vol-001");
  assert.equal(volume.userId, "user-123");
  assert.equal(volume.name, "data-volume");
  assert.equal(volume.sizeGb, 10);
  assert.equal(volume.region, "eastus2");
  assert.ok(volume.createdAt instanceof Date);
  assert.ok(volume.updatedAt instanceof Date);
});

test("Volume rejects blank id, userId, or region", (): void => {
  assert.throws(
    (): Volume => new Volume({ ...VALID_DETAILS, id: "" }),
    (error: unknown): boolean => error instanceof InvalidDomainParams && error.message.includes("Volume.id"),
  );

  assert.throws(
    (): Volume => new Volume({ ...VALID_DETAILS, userId: "   " }),
    (error: unknown): boolean => error instanceof InvalidDomainParams && error.message.includes("Volume.userId"),
  );

  assert.throws(
    (): Volume => new Volume({ ...VALID_DETAILS, region: "" }),
    (error: unknown): boolean => error instanceof InvalidDomainParams && error.message.includes("Volume.region"),
  );
});

test("Volume rejects invalid names", (): void => {
  const invalidNames: readonly string[] = [
    "a", // too short (min 2)
    "-start-hyphen",
    "end-hyphen-",
    "UPPERCASE",
    "has spaces",
    "special_character",
    "a".repeat(33), // too long (>32)
  ];

  for (const name of invalidNames) {
    assert.throws(
      (): Volume => new Volume({ ...VALID_DETAILS, name }),
      (error: unknown): boolean => error instanceof InvalidDomainParams && error.message.includes("Volume.name"),
    );
  }
});

test("Volume rejects non-positive or non-integer sizeGb", (): void => {
  assert.throws(
    (): Volume => new Volume({ ...VALID_DETAILS, sizeGb: 0 }),
    (error: unknown): boolean => error instanceof InvalidDomainParams && error.message.includes("Volume.sizeGb"),
  );

  assert.throws(
    (): Volume => new Volume({ ...VALID_DETAILS, sizeGb: -5 }),
    (error: unknown): boolean => error instanceof InvalidDomainParams && error.message.includes("Volume.sizeGb"),
  );

  assert.throws(
    (): Volume => new Volume({ ...VALID_DETAILS, sizeGb: 2.5 }),
    (error: unknown): boolean => error instanceof InvalidDomainParams && error.message.includes("Volume.sizeGb"),
  );
});
