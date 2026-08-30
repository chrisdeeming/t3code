import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev script has no Effect runtime.
const hostPlatform = NodeOS.platform();

function defaultGetProcessIdentity(pid) {
  const result =
    hostPlatform === "win32"
      ? NodeChildProcess.spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
          ],
          { encoding: "utf8", windowsHide: true },
        )
      : NodeChildProcess.spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
          encoding: "utf8",
        });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
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
  getProcessIdentity = defaultGetProcessIdentity,
  processIdentity = getProcessIdentity(pid),
  token = `${String(pid)}:${NodeCrypto.randomUUID()}`,
}) {
  if (!processIdentity) {
    throw new Error(
      `Could not determine the desktop development supervisor identity for PID ${String(pid)}.`,
    );
  }

  NodeFS.mkdirSync(NodePath.dirname(lockPath), { recursive: true });
  const candidatePath = `${lockPath}.${NodeCrypto.randomUUID()}.candidate`;

  try {
    NodeFS.writeFileSync(candidatePath, JSON.stringify({ pid, processIdentity, token }), {
      flag: "wx",
    });
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
    if (
      Number.isInteger(owner?.pid) &&
      typeof owner?.processIdentity === "string" &&
      getProcessIdentity(owner.pid) === owner.processIdentity
    ) {
      throw new Error(
        `A desktop development supervisor is already running for this worktree (PID ${String(owner.pid)}).`,
        { cause: error },
      );
    }

    throw new Error(
      `A stale desktop development supervisor lock exists at ${lockPath}. Remove it and start desktop development again.`,
      { cause: error },
    );
  } finally {
    NodeFS.rmSync(candidatePath, { force: true });
  }
}
