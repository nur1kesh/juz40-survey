"use strict";
// Сақтау қабатын таңдау: DATABASE_URL болса — PostgreSQL, әйтпесе JSON-файл.
module.exports = function createStore(opts) {
  if (opts.DATABASE_URL) return require("./store-pg")(opts);
  return require("./store-file")(opts);
};
