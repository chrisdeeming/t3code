import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

function defaultIsProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(NodeFS.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

export function acquireSupervisorLock({
  lockPath,
  pid = process.pid,
  isProcessRunning = defaultIsProcessRunning,
  token = `${String(pid)}:${NodeCrypto.randomUUID()}`,
}) {
  NodeFS.mkdirSync(NodePath.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidatePath = `${lockPath}.${NodeCrypto.randomUUID()}.candidate`;
    try {
      NodeFS.writeFileSync(candidatePath, JSON.stringify({ pid, token }), { flag: "wx" });
      NodeFS.linkSync(candidatePath, lockPath);

      return () => {
        const current = readLock(lockPath);
        if (current?.token === token) {
          NodeFS.rmSync(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const owner = readLock(lockPath);
      if (Number.isInteger(owner?.pid) && isProcessRunning(owner.pid)) {
        throw new Error(
          `A desktop development supervisor is already running for this worktree (PID ${String(owner.pid)}).`,
          { cause: error },
        );
      }

      try {
        NodeFS.rmSync(lockPath);
      } catch (removeError) {
        if (removeError?.code !== "ENOENT") {
          throw removeError;
        }
      }
    } finally {
      NodeFS.rmSync(candidatePath, { force: true });
    }
  }

  throw new Error(`Could not acquire the desktop development supervisor lock at ${lockPath}.`);
}
