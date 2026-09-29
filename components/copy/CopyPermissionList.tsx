"use client";

/**
 * The follower's own permissions. Loading and revoking each take an ed25519
 * signature over `followerProofMessage`, so nobody else can read a wallet's
 * limits or cancel its copies. Neither costs a fee.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";

import { followerProofMessage } from "@/lib/copy-trading";
import {
  listCopyPermissions,
  revokeCopyPermission,
  type CopyApiResult,
  type CopyPermissionView,
} from "@/lib/copy-client";
import { txErrorMessage } from "@/lib/tx-errors";
import CopyPermissionCard from "./CopyPermissionCard";
import { useSignText } from "./useSignText";

interface CopyPermissionListProps {
  address: string;
  onDisabled: () => void;
}

interface Loaded {
  permissions: CopyPermissionView[];
  at: number;
}

export default function CopyPermissionList({ address, onDisabled }: CopyPermissionListProps) {
  const t = useTranslations("copy");
  const signText = useSignText();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function unwrap<T>(result: CopyApiResult<T>): T | null {
    if (result.kind === "ok") return result.data;
    if (result.kind === "disabled") onDisabled();
    else setError(t("requestFailed", { message: result.message }));
    return null;
  }

  async function load() {
    if (!signText) return setError(t("noSignMessage"));
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const at = Date.now();
      const signature = await signText(followerProofMessage("list", address, at));
      const data = unwrap(await listCopyPermissions(address, at, signature));
      if (data) setLoaded({ permissions: data.permissions ?? [], at: Date.now() });
    } catch (err) {
      setError(txErrorMessage(err, t("signatureFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    if (!signText) return setError(t("noSignMessage"));
    setError(null);
    setNotice(null);
    setRevokingId(id);
    try {
      const at = Date.now();
      const signature = await signText(followerProofMessage("revoke", address, at, id));
      const data = unwrap(await revokeCopyPermission(id, address, at, signature));
      if (data) {
        setLoaded((prev) =>
          prev ? { ...prev, permissions: prev.permissions.map((p) => (p.id === id ? { ...p, active: false } : p)) } : prev,
        );
        setNotice(t("card.revoked", { id }));
      }
    } catch (err) {
      setError(txErrorMessage(err, t("signatureFailed")));
    } finally {
      setRevokingId(null);
    }
  }

  const busy = loading || revokingId !== null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 basis-60 text-xs leading-relaxed text-pv-muted">{t("list.desc")}</p>
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          onClick={() => void load()}
          disabled={busy}
          aria-busy={loading || undefined}
        >
          {loading ? t("list.signing") : loaded ? t("list.reload") : t("list.load")}
        </button>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {notice ? <p className="mt-4 text-xs text-pv-text">{notice}</p> : null}
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex items-start gap-2.5 border border-pv-danger/40 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      {loaded ? (
        loaded.permissions.length === 0 ? (
          <p className="bp-paper mt-4 border border-dashed border-pv-border/40 px-4 py-6 text-center text-xs text-pv-muted">
            {t("list.empty")}
          </p>
        ) : (
          <>
            <p className="sr-only" role="status">
              {t("list.count", { count: loaded.permissions.length })}
            </p>
            <ul className="mt-4 space-y-3">
              {loaded.permissions.map((p) => (
                <li key={p.id}>
                  <CopyPermissionCard
                    permission={p}
                    now={loaded.at}
                    revoking={revokingId === p.id}
                    locked={busy}
                    onRevoke={(id) => void revoke(id)}
                  />
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </div>
  );
}
