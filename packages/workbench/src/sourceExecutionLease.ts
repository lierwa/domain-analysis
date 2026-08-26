import type { WorkbenchDb } from "@domain-analysis/db";

import { SourceDatasetError } from "./sourceDatasetError";

export interface SourceExecutionLease {
  release(): Promise<void>;
}

export async function tryAcquireSourceExecutionLease(
  db: WorkbenchDb,
  namespace: "source-batch-lease" | "source-run-lease",
  identity: string,
): Promise<SourceExecutionLease | null> {
  const client = await db.$client.connect();
  let released = false;
  let acquired = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtext($1), hashtext($2)) as acquired",
      [namespace, identity],
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      released = true;
      return null;
    }
    acquired = true;
    return { async release() {
      if (released) return;
      released = true;
      try {
        const result = await client.query<{ unlocked: boolean }>(
          "select pg_advisory_unlock(hashtext($1), hashtext($2)) as unlocked", [namespace, identity]);
        if (!result.rows[0]?.unlocked) throw new Error(`来源执行 lease 未持有：${identity}`);
        client.release();
      } catch (error) {
        // WHY：解锁失败时连接可能仍持有 session lease，必须销毁，不能回池污染下一次执行。
        client.release(true);
        throw error;
      }
    } };
  } catch (error) {
    if (!released) {
      try {
        if (acquired) {
          await client.query("select pg_advisory_unlock(hashtext($1), hashtext($2))", [namespace, identity]);
        }
        client.release();
      } catch {
        // WHY：解锁失败的连接可能仍持有 session lease，不能放回连接池污染下一次执行。
        client.release(true);
      }
    }
    throw error;
  }
}

export async function acquireSourceExecutionLease(
  db: WorkbenchDb,
  namespace: "source-batch-lease" | "source-run-lease",
  identity: string,
  activeMessage: string,
) {
  const lease = await tryAcquireSourceExecutionLease(db, namespace, identity);
  if (!lease) throw new SourceDatasetError("invalid_state", activeMessage);
  return lease;
}
