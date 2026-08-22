/**
 * Dependency hardening hook. This is intentionally narrow and only changes
 * ExcelJS's declared UUID range; application code is not rewritten.
 */
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "exceljs" && pkg.version === "4.4.0") {
        pkg.dependencies = { ...(pkg.dependencies || {}), uuid: "^11.1.1" };
      }
      return pkg;
    },
  },
};
