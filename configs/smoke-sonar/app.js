/**
 * Minimal smoke-sonar application.
 * No deploy — this project exists only to validate Sonar + coverage CI.
 */

/**
 * Returns the sum of two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) {
  return a + b;
}

/**
 * Returns true when n is even.
 * @param {number} n
 * @returns {boolean}
 */
function isEven(n) {
  return n % 2 === 0;
}

module.exports = { add, isEven };
