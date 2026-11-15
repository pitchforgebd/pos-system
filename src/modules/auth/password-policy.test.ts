import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { createUser } from "../access/users.ts";
import { passwordProblem } from "./password-policy.ts";
import { requestPasswordReset, resetPassword } from "./password-reset.ts";
import { login } from "./login.ts";

// P12 task 5 (S10): a new password has at least 10 characters, is not a common password and is not made from the person's own email or name.

test("a new password: length, common passwords and their usual disguises, sequences, the person's own details", () => {
  assert.match(passwordProblem("short-1") ?? "", /at least 10/);
  assert.match(passwordProblem("x".repeat(129)) ?? "", /at most 128/);
  assert.match(passwordProblem("aaaaaaaaaaaa") ?? "", /repeats/);
  assert.match(passwordProblem("ababababab") ?? "", /repeats/);
  for (const common of ["1234567890", "password123", "Password123!", "P@ssw0rd2026", "qwertyuiop", "iloveyou2026", "Meridian@123", "welcome12345", "Bangladesh123", "administrator"]) {
    assert.ok(passwordProblem(common), `${common} is common`);
  }
  assert.match(passwordProblem("0123456789abc") ?? "", /sequence/);
  assert.match(passwordProblem("karimuddin-7788", { email: "karimuddin@shop.example" }) ?? "", /email/);
  assert.match(passwordProblem("my-rahima-banu-1", { name: "Rahima Banu" }) ?? "", /name/);
  for (const fine of ["tractor-seed-lamp-92", "Green fields at 6am!", "kD8#vq2LpZ", "correct-password"]) {
    assert.equal(passwordProblem(fine, { email: "someone@shop.example", name: "Someone Else" }), null, fine);
  }
});

test("a reset with a common password is refused and the link stays valid; a good password changes it, signs the user out everywhere", async () => {
  await withTestOrg(async (t) => {
    const ip = `192.0.2.${1 + Math.floor(Math.random() * 250)}`;
    const asked = await requestPasswordReset({ email: t.owner.email, ip, userAgent: "test" });
    assert.equal(asked.ok, true);
    const token = asked.ok ? asked.token : null;
    assert.ok(token);
    const weak = await resetPassword({ token, password: "Password123!", ip, userAgent: "test" });
    assert.equal(weak.ok, false);
    assert.equal(!weak.ok && weak.status, 400);
    assert.match(!weak.ok ? weak.message : "", /common/);
    const strong = await resetPassword({ token, password: "tractor-seed-lamp-92", ip, userAgent: "test" });
    assert.equal(strong.ok, true);
    const signedIn = await login({ email: t.owner.email, password: "tractor-seed-lamp-92", ip, userAgent: "test" });
    assert.equal(signedIn.ok, true);
    const reused = await resetPassword({ token, password: "another-long-one-77", ip, userAgent: "test" });
    assert.equal(reused.ok, false);
  });
});

test("a new user needs a password that passes the same rules", async () => {
  await withTestOrg(async (t) => {
    const common = {
      organizationId: t.org.id,
      actorId: t.owner.id,
      name: "New Cashier",
      email: `new-${Date.now()}@shop.example`,
      roleIds: [] as string[],
      branchIds: [t.branch.id],
      actorCanManageBranches: true,
      ip: "127.0.0.1",
      userAgent: "test",
    };
    const weak = await createUser({ ...common, password: "qwertyuiop12" });
    assert.equal(!weak.ok && weak.status, 422);
    const made = await createUser({ ...common, password: "tractor-seed-lamp-92" });
    assert.equal(made.ok, true);
    assert.equal(await prisma.user.count({ where: { organizationId: t.org.id, email: common.email } }), 1);
  });
});
