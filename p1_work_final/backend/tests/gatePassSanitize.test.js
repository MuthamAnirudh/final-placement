"use strict";
// Behavioural regression checks for gate-pass hardening (runs without node_modules via stubs).
const assert = require("assert");
const Module = require("module");
const path = require("path");
const origLoad = Module._load;
const noop = () => {};
const routerStub = new Proxy({}, { get: () => noop });
Module._load = function (request, parent, isMain) {
  if (request === "express") { const e = () => ({}); e.Router = () => routerStub; return e; }
  if (request === "express-rate-limit") return () => (q, r, n) => n && n();
  if (request === "../db") return {};
  if (request === "../middleware/auth") return { requireAuth: noop };
  return origLoad.apply(this, arguments);
};
const fs = require("fs");
const src = fs.readFileSync(path.join(__dirname, "../src/routes/gatePasses.js"), "utf8");
const m = new Module(path.join(__dirname, "../src/routes/gatePasses.js"), module);
m.filename = path.join(__dirname, "../src/routes/gatePasses.js");
m.paths = Module._nodeModulePaths(path.dirname(m.filename));
m._compile(src + "\nglobalThis.__gp={normalizeBranch,branchesMatch,sanitizeStudentPass};", m.filename);
Module._load = origLoad;
const { normalizeBranch, branchesMatch, sanitizeStudentPass } = globalThis.__gp;

assert.strictEqual(normalizeBranch("  Computer   Science\tEngineering "), "computer science engineering");
assert(branchesMatch("CSE", "Computer  Science Engineering"));
assert(branchesMatch("AI ML", "artificial intelligence & machine learning"));
assert(!branchesMatch("", "cse"));

const student = { user: { role: "STUDENT", email: "a@x.edu" } };
const created = sanitizeStudentPass(student, { id: 1, status: "approved", qrUsed: true, studentEmail: "b@x.edu", hodSignature: "x" }, null);
assert.strictEqual(created.status, "pending");
assert.strictEqual(created.studentEmail, "a@x.edu");
assert.strictEqual(created.qrUsed, false);
assert(!("hodSignature" in created));

const existing = { status: "pending", qrToken: "T", qrUsed: false, data: { stage: "teacher_mentor", teacherStatus: "pending" } };
const edited = sanitizeStudentPass(student, { reason: "new", status: "approved", stage: "done", teacherStatus: "approved" }, existing);
assert.strictEqual(edited.status, "pending");
assert.strictEqual(edited.stage, "teacher_mentor");
assert.strictEqual(edited.teacherStatus, "pending");
assert.strictEqual(edited.reason, "new");

const admin = { user: { role: "ADMIN", email: "z@x.edu" } };
const p = { status: "approved" };
assert.strictEqual(sanitizeStudentPass(admin, p, existing), p);
console.log("Gate-pass sanitize/branch behavioural checks passed.");
