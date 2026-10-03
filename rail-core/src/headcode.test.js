import { test } from "node:test";
import assert from "node:assert/strict";
import { isPassengerHeadcode } from "./headcode.js";

test("passenger headcodes are 1, 2, and 9", () => {
  assert.equal(isPassengerHeadcode("1P83"), true);
  assert.equal(isPassengerHeadcode("2T00"), true);
  assert.equal(isPassengerHeadcode("9W01"), true);
  assert.equal(isPassengerHeadcode("5P83"), false);
  assert.equal(isPassengerHeadcode("0B00"), false);
  assert.equal(isPassengerHeadcode("4E01"), false);
  assert.equal(isPassengerHeadcode(""), true);
});
