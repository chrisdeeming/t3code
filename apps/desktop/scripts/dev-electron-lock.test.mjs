import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "vite-plus/test";

import { acquireSupervisorLock } from "./dev-electron-lock.mjs";

function withTemporaryLock(run) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-electron-lock-"));
  try {
    return run(NodePath.join(directory, "supervisor.lock"));
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

describe("desktop development supervisor lock", () => {
  it("rejects a second live supervisor", () =>
    withTemporaryLock((lockPath) => {
      const release = acquireSupervisorLock({
        lockPath,
        pid: 101,
        processIdentity: "first-start",
        token: "first",
      });
      assert.deepEqual(NodeFS.readdirSync(NodePath.dirname(lockPath)), ["supervisor.lock"]);

      assert.throws(
        () =>
          acquireSupervisorLock({
            lockPath,
            pid: 202,
            processIdentity: "second-start",
            token: "second",
            getProcessIdentity: (pid) => (pid === 101 ? "first-start" : "second-start"),
          }),
        /already running.*PID 101/,
      );

      release();
    }));

  it("replaces a fully published but invalid stale lock", () =>
    withTemporaryLock((lockPath) => {
      NodeFS.writeFileSync(lockPath, "invalid");

      const release = acquireSupervisorLock({
        lockPath,
        pid: 202,
        processIdentity: "current-start",
        token: "current",
      });
      assert.deepEqual(JSON.parse(NodeFS.readFileSync(lockPath, "utf8")), {
        pid: 202,
        processIdentity: "current-start",
        token: "current",
      });

      release();
    }));

  it("replaces a stale lock after its PID is reused and only lets its current owner release it", () =>
    withTemporaryLock((lockPath) => {
      NodeFS.mkdirSync(NodePath.dirname(lockPath), { recursive: true });
      NodeFS.writeFileSync(
        lockPath,
        JSON.stringify({ pid: 101, processIdentity: "old-start", token: "stale" }),
      );

      const release = acquireSupervisorLock({
        lockPath,
        pid: 202,
        processIdentity: "current-start",
        token: "current",
        getProcessIdentity: (pid) => (pid === 101 ? "reused-start" : "current-start"),
      });
      assert.deepEqual(JSON.parse(NodeFS.readFileSync(lockPath, "utf8")), {
        pid: 202,
        processIdentity: "current-start",
        token: "current",
      });

      release();
      assert.isFalse(NodeFS.existsSync(lockPath));
    }));
});
