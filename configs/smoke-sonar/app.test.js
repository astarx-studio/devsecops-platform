const { add, isEven } = require("./app");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

assert(add(1, 2) === 3, "add(1, 2) === 3");
assert(add(-1, 1) === 0, "add(-1, 1) === 0");
assert(isEven(4) === true, "isEven(4)");
assert(isEven(3) === false, "!isEven(3)");

console.log("All assertions passed.");
