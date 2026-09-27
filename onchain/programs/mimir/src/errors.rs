use anchor_lang::prelude::*;

#[error_code]
pub enum MimirError {
    #[msg("Mimir: invalid amount")]
    InvalidAmount,
    #[msg("Mimir: stake too small")]
    StakeTooSmall,
    #[msg("Mimir: deadline in past")]
    DeadlineInPast,
    #[msg("Mimir: empty question")]
    EmptyQuestion,
    #[msg("Mimir: claim not open")]
    NotOpen,
    #[msg("Mimir: claim not active")]
    NotActive,
    #[msg("Mimir: claim not resolved")]
    NotResolved,
    #[msg("Mimir: not yet expired")]
    NotYetExpired,
    #[msg("Mimir: invalid verdict")]
    InvalidVerdict,
    #[msg("Mimir: self-challenge")]
    SelfChallenge,
    #[msg("Mimir: already challenged")]
    AlreadyChallenged,
    #[msg("Mimir: claim is full")]
    ClaimFull,
    #[msg("Mimir: challenge window closed")]
    ChallengeWindowClosed,
    #[msg("Mimir: insufficient balance")]
    InsufficientBalance,
    #[msg("Mimir: math overflow")]
    MathOverflow,
    #[msg("Mimir: not the oracle")]
    NotOracle,
    #[msg("Mimir: not the creator")]
    NotCreator,
    #[msg("Mimir: already paid")]
    AlreadyPaid,
    #[msg("Mimir: nothing to pay")]
    NothingToPay,
    #[msg("Mimir: bad challenger index")]
    BadIndex,
    #[msg("Mimir: wrong recipient")]
    WrongRecipient,
    #[msg("Mimir: claim has challengers")]
    HasChallengers,
    #[msg("Mimir: summary too long")]
    SummaryTooLong,
    // ── V3 parity ──────────────────────────────────────────────────────
    #[msg("Mimir: paused")]
    Paused,
    #[msg("Mimir: not the admin")]
    NotAdmin,
    #[msg("Mimir: not the pending admin")]
    NotPendingAdmin,
    #[msg("Mimir: zero key")]
    ZeroKey,
    #[msg("Mimir: nothing queued")]
    NothingQueued,
    #[msg("Mimir: timelocked")]
    Timelocked,
    #[msg("Mimir: fee too high")]
    FeeTooHigh,
    #[msg("Mimir: no fee recipient")]
    NoFeeRecipient,
    #[msg("Mimir: dispute window too long")]
    DisputeWindowTooLong,
    #[msg("Mimir: resolution grace out of range")]
    GraceOutOfRange,
    #[msg("Mimir: nothing to dispute")]
    NotProposed,
    #[msg("Mimir: dispute window closed")]
    DisputeWindowClosed,
    #[msg("Mimir: dispute window open")]
    DisputeWindowOpen,
    #[msg("Mimir: not a participant")]
    NotParticipant,
    #[msg("Mimir: not disputed")]
    NotDisputed,
    #[msg("Mimir: oracle grace not over")]
    GraceNotOver,
    #[msg("Mimir: agent fee account missing")]
    FeeAccountMissing,
    #[msg("Mimir: wrong agent fee account")]
    WrongFeeAccount,
    #[msg("Mimir: no bond due")]
    NoBondDue,
    #[msg("Mimir: no fees")]
    NoFees,
    #[msg("Mimir: string too long")]
    StringTooLong,
    #[msg("Mimir: claim cannot be delegated in this state")]
    CannotDelegate,
    #[msg("Mimir: not the fee authority")]
    NotFeeAuthority,
}
