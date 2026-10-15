import { test } from "node:test";
import assert from "node:assert/strict";
import { isPassengerHeadcode, trainClassDigit } from "./headcode.js";

test("passenger headcodes are 1, 2, and 9", () => {
  assert.equal(isPassengerHeadcode("1P83"), true);
  assert.equal(isPassengerHeadcode("2T00"), true);
  assert.equal(isPassengerHeadcode("9W01"), true);
  assert.equal(isPassengerHeadcode("5P83"), false);
  assert.equal(isPassengerHeadcode("0B00"), false);
  assert.equal(isPassengerHeadcode("4E01"), false);
  assert.equal(isPassengerHeadcode(""), true);
});

test("train class digit is the headcode first character", () => {
  assert.equal(trainClassDigit("6E45"), "6");
  assert.equal(trainClassDigit("5P83"), "5");
  assert.equal(trainClassDigit(""), null);
});
