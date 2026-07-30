import test from "node:test";
import assert from "node:assert/strict";

import {
  updateCommandText,
  shouldShowUpdate,
} from "../public/update-state.js";

const update = {
  status: "available",
  latestVersion: "0.3.0",
  updateCommands: ["upgrade marketplace", "install plugin"],
};

test("shouldShowUpdate hides unavailable, current, and dismissed releases", () => {
  assert.equal(shouldShowUpdate(update, null), true);
  assert.equal(shouldShowUpdate(update, "0.3.0"), false);
  assert.equal(shouldShowUpdate({ status: "current" }, null), false);
  assert.equal(shouldShowUpdate({ status: "unavailable" }, null), false);
});

test("updateCommandText produces one copyable terminal block", () => {
  assert.equal(updateCommandText(update), "upgrade marketplace\ninstall plugin");
});
