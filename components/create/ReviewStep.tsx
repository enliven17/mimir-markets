"use client";

/** Step 4: the ticket as it will be published, the optional council preflight, and publish (or connect first). */
import { useTranslations } from "next-intl";
import { Zap } from "lucide-react";
import Button from "@/components/ui/Button";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import CreateChallengeTicket from "@/components/vs/CreateChallengeTicket";
import CouncilPreflight from "@/components/council/CouncilPreflight";
import { sourceOf } from "@/components/arena/detail/source";
import type { CreateDraft } from "./useCreateDraft";

export default function ReviewStep({ draft }: { draft: CreateDraft }) {
  const t = useTranslations("arena.create");
  const tc = useTranslations("create");
  const f = draft.fields;
  const d = draft.derived;

  return (
    <div className="grid gap-4">
      <CreateChallengeTicket
        draftId={d.draftId}
        question={f.question.trim()}
        creatorPosition={f.creatorPos.trim()}
        counterPosition={f.opponentPos.trim()}
        stakeAmount={f.stake}
        deadline={d.deadlineSec}
        sourceHost={d.finalResolutionUrl ? sourceOf(d.finalResolutionUrl).host : null}
        category={f.category}
        marketTypeLabel={tc("marketTypes.binary" as "marketType")}
        oddsModeLabel={tc("oddsModes.pool" as "oddsMode")}
        formatLabel={tc("headToHeadSummary")}
        visibilityLabel={tc("visibilityPublic")}
        settlementPreview={d.settlementPreview}
        walletAddress={draft.walletAddress}
      />

      <CouncilPreflight draft={d.preflightDraft} />

      {draft.error ? (
        <p role="alert" className="m-0 rounded-xl bg-danger/[0.1] px-4 py-3 text-[14px] text-danger">
          {draft.error}
        </p>
      ) : null}

      {draft.connected ? (
        <Button onClick={() => void draft.publish()} loading={!!draft.busy} disabled={!!draft.busy}>
          {draft.busy ?? (
            <>
              <span>{t("publish", { amount: f.stake })}</span>
              <Zap className="size-5 shrink-0" aria-hidden />
            </>
          )}
        </Button>
      ) : (
        <div className="grid justify-items-center gap-3 rounded-2xl bg-cream/[0.035] p-5 text-center">
          <p className="m-0 text-[14px] text-muted">{t("connectToPublish")}</p>
          <ConnectWalletButton />
        </div>
      )}

      <p className="m-0 text-center text-[12px] text-muted">
        {t("faucet")}{" "}
        <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral">
          {t("faucetLink")}
        </a>
      </p>
    </div>
  );
}
