// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// The entry-fee rate per account (contracts/MimirFees.sol).
interface IMimirFees {
    function entryBps(address account) external view returns (uint16);
}

/**
 * MimirV3 — AI-settled VS (duel) market on Arc. Native USDC only: stakes are
 * msg.value (18 decimals), there is no approval step.
 *
 * Fees:
 *   - An entry fee on every stake that opens or joins a claim (create,
 *     rematch, challenge): MimirFees.entryBps(msg.sender) of the amount sent,
 *     0.5% by default and less for $MIMIR holders with a signed ticket. The
 *     rest is the stake. The fee is earned on entry and kept on refunds.
 *   - No fee on winnings, except on copy trades: a position opened with a
 *     `referrer` (the basket creator it copies) pays REFERRER_FEE_BPS of its
 *     PROFIT to the referrer and COPY_FEE_BPS to the platform. Never on a
 *     loss, a draw or a refund, so a winner never gets back less than staked.
 *   - The fee recipient changes only through a timelock. Fees accrue to a
 *     pull balance: a push to a recipient that reverts would take the whole
 *     settlement down with it.
 *   - Settlement pushes carry a fixed gas stipend, so a recipient contract
 *     cannot burn the resolve transaction's gas; anything it refuses is parked.
 *   - An escape hatch: an ACTIVE claim the oracle has not resolved within
 *     RESOLUTION_GRACE_SECONDS of its deadline can be refunded by anyone.
 *   - Two-step ownership, a timelocked oracle change and a pause switch that
 *     stops new positions but never settlement, refunds or withdrawals.
 *
 * Known limit: invite keys travel in calldata, so a private claim hides its
 * link from the UI, not from someone reading the chain.
 */
contract MimirV3 {
    // ── State constants ───────────────────────────────────────────────────────
    uint8 public constant ST_OPEN        = 0;
    uint8 public constant ST_ACTIVE      = 1;
    uint8 public constant ST_RESOLVED    = 2;
    uint8 public constant ST_CANCELLED   = 3;
    /// The oracle has proposed a verdict; it can be disputed until the window closes.
    uint8 public constant ST_PROPOSED    = 4;
    /// A participant disputed the proposal; the arbiter (owner) decides.
    uint8 public constant ST_DISPUTED    = 5;

    // Winner side constants
    uint8 public constant SIDE_NONE          = 0;
    uint8 public constant SIDE_CREATOR       = 1;
    uint8 public constant SIDE_CHALLENGERS   = 2;
    uint8 public constant SIDE_DRAW          = 3;
    uint8 public constant SIDE_UNRESOLVABLE  = 4;

    // ── Limits ────────────────────────────────────────────────────────────────
    uint256 public constant MAX_CHALLENGERS        = 100;
    /// Pool odds: the challengers' total stake may not exceed this multiple of
    /// the creator's stake, so each challenger's upside stays meaningful.
    uint256 public constant MAX_POOL_MULTIPLE      = 5;
    /// 2 USDC (native, 18 decimals): the smallest amount a position may send, and the dispute bond.
    uint256 public constant MIN_STAKE = 2e18;
    uint256 public constant DEFAULT_PAYOUT_BPS     = 20_000;    // 2x

    // Anti-sniping: no new challenges accepted in the final N seconds before
    // a claim's deadline. Stops late-information actors from waiting to see
    // the outcome and slipping in a zero-risk bet.
    uint256 public constant CHALLENGE_LOCK_SECONDS = 60;

    // ── Fees ──────────────────────────────────────────────────────────────────
    /// Copy trades: the referrer's (basket creator's) share of a winning position's profit.
    uint16  public constant REFERRER_FEE_BPS = 100;
    /// Copy trades: the platform's share of a winning position's profit.
    uint16  public constant COPY_FEE_BPS = 100;
    /// A new fee recipient waits this long.
    uint256 public constant FEE_TIMELOCK_SECONDS = 2 days;
    /// An oracle change waits this long, so participants can react to a new settler.
    uint256 public constant ORACLE_TIMELOCK_SECONDS = 2 days;
    /// An ownership transfer waits this long, so a stolen owner key cannot
    /// install a new arbiter before anyone can react.
    uint256 public constant OWNERSHIP_TIMELOCK_SECONDS = 2 days;
    /// After deadline + this, an unresolved ACTIVE claim can be refunded by anyone.
    uint256 public constant RESOLUTION_GRACE_SECONDS = 7 days;
    /// Gas forwarded with each settlement push: enough for a plain receive or a
    /// USDC transfer, not enough for one recipient to starve the payout loop.
    uint256 public constant PUSH_GAS = 50_000;
    /// Upper bound on the dispute window, so a deploy cannot park payouts for weeks.
    uint256 public constant MAX_DISPUTE_WINDOW = 7 days;

    // ── Storage ───────────────────────────────────────────────────────────────
    struct Claim {
        address creator;
        string  question;
        string  creatorPosition;
        string  counterPosition;
        string  resolutionUrl;
        uint256 creatorStake;
        uint256 totalChallengerStake;
        uint256 reservedCreatorLiability;
        uint256 deadline;
        uint8   state;
        uint8   winnerSide;
        string  resolutionSummary;
        uint8   confidence;
        string  category;
        uint256 parentId;
        uint256 challengerCount;
        uint256 createdAt;
        // Market config
        string  marketType;          // binary | moneyline | spread | total | prop | custom
        string  oddsMode;            // pool | fixed
        uint256 challengerPayoutBps; // for fixed odds (e.g. 20000 = 2x)
        string  handicapLine;
        string  settlementRule;
        uint256 maxChallengers;
        bool    isPrivate;
        bytes32 inviteKeyHash;       // keccak256(inviteKey) for private claims
        bytes32 evidenceHash;        // keccak256(evidence content) — verifiable reasoning trace
    }

    mapping(uint256 => Claim)   public claims;
    /// Referrer (copied basket's creator) of the creator's position, set at creation.
    mapping(uint256 => address) public claimReferrer;
    /// Entry fees taken on a claim (creator and challengers), for display.
    mapping(uint256 => uint256) public claimEntryFees;

    // claimId * MAX_CHALLENGERS + index → address / net stake / referrer
    mapping(uint256 => address) public challengerAddresses;
    mapping(uint256 => uint256) public challengerStakes;
    mapping(uint256 => address) public challengerReferrer;
    // Prevents double-entry per claim
    mapping(uint256 => mapping(address => bool)) public hasChallenged;

    mapping(address => uint256) public wins;
    mapping(address => uint256) public losses;

    // Pull-payment fallback. A payout is normally pushed during resolveClaim,
    // but if the recipient's receive() reverts (e.g. a contract that refuses
    // funds), the amount is parked here instead of reverting the whole
    // settlement — one bad recipient can't freeze everyone else's payout.
    // The recipient pulls it later via withdraw().
    mapping(address => uint256) public pendingWithdrawals;

    /// Fees owed to a recipient, claimed with claimFees(). Never pushed.
    mapping(address => uint256) public accruedFees;

    uint256 public claimCount;
    uint256 public totalResolved;
    uint256 public lifetimeFeesAccrued;
    uint256 public lifetimeFeesClaimed;

    address public owner;
    address public pendingOwner;
    /// Timestamp from which pendingOwner may accept. 0 = nothing queued.
    uint256 public pendingOwnerEta;
    address public oracle; // off-chain AI oracle agent
    address public pendingOracle;
    /// Timestamp from which pendingOracle may be installed. 0 = nothing queued.
    uint256 public pendingOracleEta;
    /// Stops new claims and challenges. Never stops settlement or withdrawals.
    bool public paused;

    /// Seconds a proposed verdict stays disputable. 0 settles immediately (v3.0 behaviour).
    uint256 public immutable disputeWindow;

    struct Proposal {
        uint8   winnerSide;
        uint8   confidence;
        uint64  proposedAt;
        uint64  disputedAt;
        address disputer;
        uint256 bond;
        bytes32 evidenceHash;
        string  summary;
    }
    mapping(uint256 => Proposal) public proposals;

    /// Entry-fee rates per account.
    IMimirFees public immutable fees;
    /// Receives entry fees, the copy-trade platform share and forfeited dispute bonds.
    address public feeRecipient;
    address public pendingFeeRecipient;
    /// Timestamp from which pendingFeeRecipient may be installed. 0 = nothing queued.
    uint256 public pendingFeeRecipientEta;

    /// Reentrancy lock: 1 = free, 2 = entered.
    uint256 private _lock = 1;

    // ── Events ────────────────────────────────────────────────────────────────
    event ClaimCreated(uint256 indexed id, address indexed creator, string category);
    event ClaimChallenged(uint256 indexed id, address indexed challenger, uint256 stake);
    event ClaimResolved(uint256 indexed id, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash);
    event ClaimCancelled(uint256 indexed id);
    event OracleChanged(address indexed previous, address indexed next);
    event WithdrawalPending(address indexed to, uint256 amount);
    event Withdrawal(address indexed account, address indexed to, uint256 amount);
    event ReferrerSet(uint256 indexed id, address indexed participant, address indexed referrer);
    event FeeRecipientQueued(address indexed next, uint256 eta);
    event FeeRecipientCancelled(address indexed next);
    event FeeRecipientChanged(address indexed previous, address indexed next);
    event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount);
    event FeeClaimed(address indexed recipient, address indexed to, uint256 amount);
    event MarketSettled(uint256 indexed id, uint256 totalPaid, uint256 totalFees);
    event ClaimExpiredRefund(uint256 indexed id, address indexed caller);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferCancelled(address indexed pendingOwner);
    event OracleChangeQueued(address indexed next, uint256 eta);
    event OracleChangeCancelled(address indexed next);
    event Paused(bool paused);
    event ResolutionProposed(uint256 indexed id, uint8 winnerSide, uint8 confidence, bytes32 evidenceHash, uint256 disputableUntil);
    event ResolutionDisputed(uint256 indexed id, address indexed disputer, uint256 bond);
    event DisputeResolved(uint256 indexed id, uint8 winnerSide, bool disputerRight);

    // Custom errors for reverts added after the 2026-10-06 review (EIP-170 budget).
    error Reentrant();
    error GraceOver();
    /// A pool-odds challenge would take the challenger side past MAX_POOL_MULTIPLE x the creator's stake.
    error PoolFull();

    // ── Modifiers ─────────────────────────────────────────────────────────────
    // Modifiers call private checks so the code exists once, not per function (EIP-170).
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier onlyOracle() {
        _checkOracle();
        _;
    }

    modifier whenNotPaused() {
        _checkNotPaused();
        _;
    }

    function _checkOwner() private view {
        require(msg.sender == owner, "Mimir: not owner");
    }

    function _checkOracle() private view {
        require(msg.sender == oracle, "Mimir: not oracle");
    }

    function _checkNotPaused() private view {
        require(!paused, "Mimir: paused");
    }

    /// Every entry point that can move value takes the lock, so a recipient
    /// cannot re-enter settlement even with more gas than PUSH_GAS.
    modifier nonReentrant() {
        _enter();
        _;
        _lock = 1;
    }

    function _enter() private {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address _oracle, address _feeRecipient, IMimirFees _fees, uint256 _disputeWindow) {
        require(_oracle != address(0) && _feeRecipient != address(0), "Mimir: zero address");
        require(address(_fees).code.length > 0, "Mimir: fees has no code");
        require(_disputeWindow <= MAX_DISPUTE_WINDOW, "Mimir: dispute window too long");
        disputeWindow = _disputeWindow;
        owner  = msg.sender;
        oracle = _oracle;
        fees   = _fees;
        feeRecipient = _feeRecipient;
        emit OwnershipTransferred(address(0), msg.sender);
        emit OracleChanged(address(0), _oracle);
        emit FeeRecipientChanged(address(0), _feeRecipient);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    /// Queue a new oracle, installable after ORACLE_TIMELOCK_SECONDS, so a
    /// compromised owner key cannot make itself the settler and resolve open
    /// markets before anyone notices.
    function queueOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Mimir: zero oracle");
        pendingOracle = _oracle;
        pendingOracleEta = block.timestamp + ORACLE_TIMELOCK_SECONDS;
        emit OracleChangeQueued(_oracle, pendingOracleEta);
    }

    function cancelOracle() external onlyOwner {
        require(pendingOracleEta != 0, "Mimir: nothing queued");
        emit OracleChangeCancelled(pendingOracle);
        pendingOracle = address(0);
        pendingOracleEta = 0;
    }

    /// Permissionless once the timelock has elapsed, like executeFeeRecipient.
    function executeOracle() external {
        require(pendingOracleEta != 0, "Mimir: nothing queued");
        require(block.timestamp >= pendingOracleEta, "Mimir: timelocked");
        emit OracleChanged(oracle, pendingOracle);
        oracle = pendingOracle;
        pendingOracle = address(0);
        pendingOracleEta = 0;
    }

    /// Step one of two: the new owner must accept, so a typo cannot brick admin,
    /// and cannot accept before OWNERSHIP_TIMELOCK_SECONDS. Queuing again restarts the clock.
    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "Mimir: zero owner");
        pendingOwner = _owner;
        pendingOwnerEta = block.timestamp + OWNERSHIP_TIMELOCK_SECONDS;
        emit OwnershipTransferStarted(owner, _owner);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        require(pendingOwnerEta != 0, "Mimir: nothing queued");
        emit OwnershipTransferCancelled(pendingOwner);
        pendingOwner = address(0);
        pendingOwnerEta = 0;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Mimir: not pending owner");
        require(block.timestamp >= pendingOwnerEta, "Mimir: timelocked");
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
        pendingOwnerEta = 0;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    // ── Fee recipient (timelocked) ────────────────────────────────────────────
    function queueFeeRecipient(address next) external onlyOwner {
        require(next != address(0), "Mimir: zero recipient");
        pendingFeeRecipient = next;
        pendingFeeRecipientEta = block.timestamp + FEE_TIMELOCK_SECONDS;
        emit FeeRecipientQueued(next, pendingFeeRecipientEta);
    }

    function cancelFeeRecipient() external onlyOwner {
        require(pendingFeeRecipientEta != 0, "Mimir: nothing queued");
        emit FeeRecipientCancelled(pendingFeeRecipient);
        pendingFeeRecipient = address(0);
        pendingFeeRecipientEta = 0;
    }

    /// Permissionless once due: the owner cannot queue a change and then quietly withhold it.
    function executeFeeRecipient() external {
        require(pendingFeeRecipientEta != 0, "Mimir: nothing queued");
        require(block.timestamp >= pendingFeeRecipientEta, "Mimir: timelocked");
        emit FeeRecipientChanged(feeRecipient, pendingFeeRecipient);
        feeRecipient = pendingFeeRecipient;
        pendingFeeRecipient = address(0);
        pendingFeeRecipientEta = 0;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    function _chKey(uint256 claimId, uint256 index) internal pure returns (uint256) {
        return claimId * MAX_CHALLENGERS + index;
    }

    /// Take `amount` (exactly msg.value), keep msg.sender's entry fee and
    /// return the rest: the stake that is recorded and can be won or refunded.
    function _takeEntry(uint256 claimId, uint256 amount) internal returns (uint256 net) {
        require(msg.value == amount, "Mimir: wrong USDC value");
        uint256 fee = (amount * fees.entryBps(msg.sender)) / 10_000;
        if (fee != 0) {
            _accrue(claimId, feeRecipient, fee);
            claimEntryFees[claimId] += fee;
        }
        net = amount - fee;
    }

    function _accrue(uint256 claimId, address to, uint256 amount) internal {
        accruedFees[to] += amount;
        lifetimeFeesAccrued += amount;
        emit FeeAccrued(claimId, to, amount);
    }

    /// Send that reports failure instead of reverting. A blacklisted USDC
    /// recipient reverts rather than returning false, so both are caught.
    /// `gasLimit` 0 forwards all gas (withdrawals, where the caller pays for
    /// their own receiver); settlement pushes pass PUSH_GAS.
    function _trySend(address to, uint256 amount, uint256 gasLimit) internal returns (bool ok) {
        uint256 g = gasLimit == 0 ? gasleft() : gasLimit;
        // Assembly so no returndata is copied: a recipient cannot answer
        // with a huge revert payload and make the copy itself run out of gas.
        assembly ("memory-safe") {
            ok := call(g, to, amount, 0, 0, 0, 0)
        }
    }

    function _transfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!_trySend(to, amount, PUSH_GAS)) {
            // Failed push (recipient rejected funds) → park for pull-withdrawal
            // so a single uncooperative recipient can't revert the settlement.
            pendingWithdrawals[to] += amount;
            emit WithdrawalPending(to, amount);
        }
    }

    /**
     * Pay a winner. Only a copy trade (a position with a referrer) pays a fee
     * on winnings: REFERRER_FEE_BPS of the profit to the referrer and
     * COPY_FEE_BPS to the platform. The base is `gross - principal` floored at
     * zero, so a refund and a break-even win are free and a winner never gets
     * back less than staked. Nobody pays themselves: a referrer or fee
     * recipient who is the winner waives that leg.
     *
     * The referrer is chosen by the account that opened the position, with no
     * allowlist: a passkey account signs a hash, so a compromised front end can
     * already make it do anything; a list would only have guarded this 1%.
     */
    function _payWinner(
        uint256 claimId,
        address to,
        uint256 gross,
        uint256 principal,
        address referrer
    ) internal returns (uint256 paid, uint256 taken) {
        uint256 profit = gross > principal ? gross - principal : 0;
        if (profit != 0 && referrer != address(0) && referrer != to) {
            uint256 refFee = (profit * REFERRER_FEE_BPS) / 10_000;
            if (refFee != 0) _accrue(claimId, referrer, refFee);
            uint256 copyFee = feeRecipient == to ? 0 : (profit * COPY_FEE_BPS) / 10_000;
            if (copyFee != 0) _accrue(claimId, feeRecipient, copyFee);
            taken = refFee + copyFee;
        }
        paid = gross - taken;
        _transfer(to, paid);
    }

    // ── Withdraw: pull a parked payout ────────────────────────────────────────
    function withdraw() external {
        _withdrawTo(msg.sender);
    }

    /// Pull a parked payout to another address. A USDC-blacklisted recipient
    /// can never receive at its own address, so without this it stays stuck.
    function withdrawTo(address to) external {
        require(to != address(0), "Mimir: zero recipient");
        _withdrawTo(to);
    }

    function _withdrawTo(address to) internal nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Mimir: nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0; // effects before interaction (reentrancy-safe)
        require(_trySend(to, amount, 0), "Mimir: withdraw failed");
        emit Withdrawal(msg.sender, to, amount);
    }

    // ── Claim accrued fees ────────────────────────────────────────────────────
    function claimFees() external {
        _claimFeesTo(msg.sender);
    }

    /// Claim to another address: a blocklisted fee recipient could never be paid otherwise.
    function claimFeesTo(address to) external {
        require(to != address(0), "Mimir: zero recipient");
        _claimFeesTo(to);
    }

    function _claimFeesTo(address to) internal nonReentrant {
        uint256 amount = accruedFees[msg.sender];
        require(amount > 0, "Mimir: no fees");
        accruedFees[msg.sender] = 0;
        lifetimeFeesClaimed += amount;
        require(_trySend(to, amount, 0), "Mimir: fee claim failed");
        emit FeeClaimed(msg.sender, to, amount);
    }

    function _grossPayout(uint256 stake, uint256 bps) internal pure returns (uint256) {
        return (stake * bps) / 10_000;
    }

    // ── Write: create ─────────────────────────────────────────────────────────
    struct CreateArgs {
        string  question;
        string  creatorPosition;
        string  counterPosition;
        string  resolutionUrl;
        uint256 deadline;
        uint256 stakeAmount;
        string  category;
        uint256 parentId;
        string  marketType;
        string  oddsMode;
        uint256 challengerPayoutBps;
        string  handicapLine;
        string  settlementRule;
        uint256 maxChallengers;
        bool    isPrivate;
        string  inviteKey;
        address referrer;
    }

    function createClaim(
        string  calldata question,
        string  calldata creatorPosition,
        string  calldata counterPosition,
        string  calldata resolutionUrl,
        uint256          deadline,
        uint256          stakeAmount,
        string  calldata category,
        uint256          parentId,
        string  calldata marketType,
        string  calldata oddsMode,
        uint256          challengerPayoutBps,
        string  calldata handicapLine,
        string  calldata settlementRule,
        uint256          maxChallengers,
        bool             isPrivate,
        string  calldata inviteKey,
        address          referrer
    ) external payable whenNotPaused nonReentrant returns (uint256 id) {
        return _createClaim(CreateArgs({
            question:            question,
            creatorPosition:     creatorPosition,
            counterPosition:     counterPosition,
            resolutionUrl:       resolutionUrl,
            deadline:            deadline,
            stakeAmount:         stakeAmount,
            category:            category,
            parentId:            parentId,
            marketType:          marketType,
            oddsMode:            oddsMode,
            challengerPayoutBps: challengerPayoutBps,
            handicapLine:        handicapLine,
            settlementRule:      settlementRule,
            maxChallengers:      maxChallengers,
            isPrivate:           isPrivate,
            inviteKey:           inviteKey,
            referrer:            referrer
        }));
    }

    function _createClaim(CreateArgs memory a) internal returns (uint256 id) {
        require(a.stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        require(a.deadline > block.timestamp, "Mimir: deadline in past");
        require(bytes(a.question).length > 0, "Mimir: empty question");
        // A private claim with no key would silently be public (a rematch of a
        // private parent included).
        require(!a.isPrivate || bytes(a.inviteKey).length > 0, "Mimir: private claim needs invite key");

        // Normalise odds params
        bool isFixed = _strEq(a.oddsMode, "fixed");
        uint256 payoutBps = isFixed
            ? (a.challengerPayoutBps >= 10_000 ? a.challengerPayoutBps : DEFAULT_PAYOUT_BPS)
            : 0;

        uint256 maxCh = (a.maxChallengers == 0 || a.maxChallengers > MAX_CHALLENGERS)
            ? MAX_CHALLENGERS
            : a.maxChallengers;

        claimCount++;
        id = claimCount;
        uint256 net = _takeEntry(id, a.stakeAmount);

        claims[id] = Claim({
            creator:                  msg.sender,
            question:                 a.question,
            creatorPosition:          a.creatorPosition,
            counterPosition:          a.counterPosition,
            resolutionUrl:            a.resolutionUrl,
            creatorStake:             net,
            totalChallengerStake:     0,
            reservedCreatorLiability: 0,
            deadline:                 a.deadline,
            state:                    ST_OPEN,
            winnerSide:               SIDE_NONE,
            resolutionSummary:        "",
            confidence:               0,
            category:                 bytes(a.category).length > 0 ? a.category : "custom",
            parentId:                 a.parentId,
            challengerCount:          0,
            createdAt:                block.timestamp,
            marketType:               bytes(a.marketType).length > 0 ? a.marketType : "binary",
            oddsMode:                 isFixed ? "fixed" : "pool",
            challengerPayoutBps:      payoutBps,
            handicapLine:             a.handicapLine,
            settlementRule:           a.settlementRule,
            maxChallengers:           maxCh,
            isPrivate:                a.isPrivate,
            inviteKeyHash:            bytes(a.inviteKey).length > 0
                                          ? keccak256(bytes(a.inviteKey))
                                          : bytes32(0),
            evidenceHash:             bytes32(0)
        });

        if (a.referrer != address(0)) {
            claimReferrer[id] = a.referrer;
            emit ReferrerSet(id, msg.sender, a.referrer);
        }

        emit ClaimCreated(id, msg.sender, claims[id].category);
    }

    // Rematch: a new claim inheriting fields from a parent. An internal call,
    // so the caller (not this contract) is the creator and pays the stake.
    function createRematch(
        uint256 parentId,
        uint256 deadline,
        uint256 stakeAmount,
        string  calldata inviteKey
    ) external payable whenNotPaused nonReentrant returns (uint256 id) {
        Claim storage parent = claims[parentId];
        require(parent.creator != address(0), "Mimir: parent not found");

        return _createClaim(CreateArgs({
            question:            parent.question,
            creatorPosition:     parent.creatorPosition,
            counterPosition:     parent.counterPosition,
            resolutionUrl:       parent.resolutionUrl,
            deadline:            deadline,
            stakeAmount:         stakeAmount,
            category:            parent.category,
            parentId:            parentId,
            marketType:          parent.marketType,
            oddsMode:            parent.oddsMode,
            challengerPayoutBps: parent.challengerPayoutBps,
            handicapLine:        parent.handicapLine,
            settlementRule:      parent.settlementRule,
            maxChallengers:      parent.maxChallengers,
            isPrivate:           parent.isPrivate,
            inviteKey:           inviteKey,
            // The parent's referrer earned it on the parent's creator; a
            // stranger rematching the claim does not inherit it.
            referrer:            msg.sender == parent.creator ? claimReferrer[parentId] : address(0)
        }));
    }

    // ── Write: challenge ──────────────────────────────────────────────────────
    function challengeClaim(
        uint256 claimId,
        uint256 stakeAmount,
        string  calldata inviteKey,
        address referrer
    ) external payable whenNotPaused nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_OPEN || claim.state == ST_ACTIVE, "Mimir: not open");
        require(msg.sender != claim.creator, "Mimir: self-challenge");
        require(!hasChallenged[claimId][msg.sender], "Mimir: already challenged");
        require(claim.challengerCount < claim.maxChallengers, "Mimir: full");
        require(stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        // Anti-sniping: challenges must arrive at least CHALLENGE_LOCK_SECONDS
        // before the deadline so the outcome isn't observable yet.
        require(
            block.timestamp + CHALLENGE_LOCK_SECONDS <= claim.deadline,
            "Mimir: challenge window closed"
        );
        uint256 net = _takeEntry(claimId, stakeAmount);

        // Private claim: verify invite key
        if (claim.isPrivate && claim.inviteKeyHash != bytes32(0)) {
            require(
                keccak256(bytes(inviteKey)) == claim.inviteKeyHash,
                "Mimir: invalid invite key"
            );
        }

        // Fixed odds: ensure creator has enough unreserved liquidity
        if (_strEq(claim.oddsMode, "fixed")) {
            uint256 gross   = _grossPayout(net, claim.challengerPayoutBps);
            uint256 profit  = gross > net ? gross - net : 0;
            uint256 avail   = claim.creatorStake - claim.reservedCreatorLiability;
            require(avail >= profit, "Mimir: creator has insufficient liquidity");
            claim.reservedCreatorLiability += profit;
        } else if (claim.totalChallengerStake + net > claim.creatorStake * MAX_POOL_MULTIPLE) {
            revert PoolFull();
        }

        uint256 key = _chKey(claimId, claim.challengerCount);
        challengerAddresses[key]          = msg.sender;
        challengerStakes[key]             = net;
        hasChallenged[claimId][msg.sender] = true;

        if (referrer != address(0)) {
            challengerReferrer[key] = referrer;
            emit ReferrerSet(claimId, msg.sender, referrer);
        }

        claim.totalChallengerStake += net;
        claim.challengerCount++;
        claim.state = ST_ACTIVE;

        emit ClaimChallenged(claimId, msg.sender, net);
    }

    // ── Write: resolve (oracle only) ──────────────────────────────────────────
    function resolveClaim(
        uint256 claimId,
        uint8   winnerSide,
        string  calldata summary,
        uint8   confidence,
        bytes32 evidenceHash  // keccak256 of evidence text — verifiable on-chain
    ) external onlyOracle nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_ACTIVE, "Mimir: not active");
        require(block.timestamp >= claim.deadline, "Mimir: not yet expired");
        if (block.timestamp >= _refundAt(claimId)) revert GraceOver();
        require(
            winnerSide == SIDE_CREATOR ||
            winnerSide == SIDE_CHALLENGERS ||
            winnerSide == SIDE_DRAW ||
            winnerSide == SIDE_UNRESOLVABLE,
            "Mimir: invalid verdict"
        );
        if (disputeWindow == 0) {
            _settle(claimId, winnerSide, summary, confidence, evidenceHash);
            return;
        }
        // Optimistic: the verdict stands unless a participant disputes it in time.
        claim.state = ST_PROPOSED;
        proposals[claimId] = Proposal({
            winnerSide:   winnerSide,
            confidence:   confidence,
            proposedAt:   uint64(block.timestamp),
            disputedAt:   0,
            disputer:     address(0),
            bond:         0,
            evidenceHash: evidenceHash,
            summary:      summary
        });
        emit ResolutionProposed(claimId, winnerSide, confidence, evidenceHash, block.timestamp + disputeWindow);
    }

    /**
     * A participant who believes the proposed verdict is wrong escalates it to
     * the arbiter (the owner, a multisig in production) by posting a bond of
     * MIN_STAKE. The bond comes back if the arbiter changes the verdict and is
     * forfeited to the platform if it does not, so disputes cost something to
     * spam and nothing to raise when right.
     */
    function disputeResolution(uint256 claimId) external payable nonReentrant {
        Claim storage claim = claims[claimId];
        Proposal storage p = proposals[claimId];
        require(claim.state == ST_PROPOSED, "Mimir: nothing to dispute");
        require(block.timestamp < p.proposedAt + disputeWindow, "Mimir: dispute window closed");
        require(msg.sender == claim.creator || hasChallenged[claimId][msg.sender], "Mimir: not a participant");
        // The bond is not a position: no entry fee.
        require(msg.value == MIN_STAKE, "Mimir: wrong USDC value");
        claim.state  = ST_DISPUTED;
        p.disputer   = msg.sender;
        p.disputedAt = uint64(block.timestamp);
        p.bond       = MIN_STAKE;
        emit ResolutionDisputed(claimId, msg.sender, MIN_STAKE);
    }

    /// Anyone can settle an undisputed proposal once its window has closed.
    function finalizeResolution(uint256 claimId) external nonReentrant {
        Proposal storage p = proposals[claimId];
        require(claims[claimId].state == ST_PROPOSED, "Mimir: not proposed");
        require(block.timestamp >= p.proposedAt + disputeWindow, "Mimir: dispute window open");
        _settle(claimId, p.winnerSide, p.summary, p.confidence, p.evidenceHash);
    }

    /// The arbiter's final word on a disputed claim.
    function resolveDispute(
        uint256 claimId,
        uint8   winnerSide,
        string  calldata summary,
        uint8   confidence,
        bytes32 evidenceHash
    ) external onlyOwner nonReentrant {
        Proposal storage p = proposals[claimId];
        require(claims[claimId].state == ST_DISPUTED, "Mimir: not disputed");
        if (block.timestamp >= _refundAt(claimId)) revert GraceOver();
        require(winnerSide >= SIDE_CREATOR && winnerSide <= SIDE_UNRESOLVABLE, "Mimir: invalid verdict");
        bool disputerRight = winnerSide != p.winnerSide;
        emit DisputeResolved(claimId, winnerSide, disputerRight);
        // Settle first: the claim is RESOLVED before any value leaves, bond included.
        _settle(claimId, winnerSide, summary, confidence, evidenceHash);
        _settleBond(claimId, p, disputerRight);
    }

    /// Bond back to a disputer who was right; to the fee recipient otherwise,
    /// including when nobody ruled.
    function _settleBond(uint256 claimId, Proposal storage p, bool returnIt) internal {
        uint256 bond = p.bond;
        if (bond == 0) return;
        p.bond = 0;
        if (returnIt) _transfer(p.disputer, bond);
        else _accrue(claimId, feeRecipient, bond);
    }

    /**
     * Escape hatch. If the oracle has not resolved an ACTIVE claim within
     * RESOLUTION_GRACE_SECONDS of its deadline (lost key, custody outage,
     * a settlement that keeps reverting), anyone can refund it: every
     * participant gets their stake back, exactly as an UNRESOLVABLE verdict
     * would pay (the entry fee stays earned). Without this, the oracle going away
     * would lock every open stake forever.
     */
    function refundExpired(uint256 claimId) external nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        // A disputed claim the arbiter never rules on gets the same escape hatch,
        // counted from the dispute. The bond is kept (platform fees), so a cheap
        // dispute cannot stall a losing verdict into a free refund.
        bool disputed = claim.state == ST_DISPUTED;
        require(disputed || claim.state == ST_ACTIVE, "Mimir: not active");
        require(block.timestamp >= _refundAt(claimId), "Mimir: oracle grace not over");
        emit ClaimExpiredRefund(claimId, msg.sender);
        _settle(claimId, SIDE_UNRESOLVABLE, "Refunded: not resolved within the grace period", 0, bytes32(0));
        if (disputed) _settleBond(claimId, proposals[claimId], false);
    }

    /// When refundExpired opens for a claim: grace counted from the deadline,
    /// or from the dispute if there was one. From then on verdicts are refused,
    /// so the outcome depends on the clock, not on transaction order.
    function _refundAt(uint256 claimId) internal view returns (uint256 start) {
        start = claims[claimId].deadline;
        // disputedAt is only ever set on a disputed claim.
        uint256 disputedAt = proposals[claimId].disputedAt;
        if (disputedAt > start) start = disputedAt;
        start += RESOLUTION_GRACE_SECONDS;
    }

    function _settle(
        uint256 claimId,
        uint8   winnerSide,
        string memory summary,
        uint8   confidence,
        bytes32 evidenceHash
    ) internal {
        Claim storage claim = claims[claimId];
        claim.state             = ST_RESOLVED;
        claim.winnerSide        = winnerSide;
        claim.resolutionSummary = summary;
        claim.confidence        = confidence;
        claim.evidenceHash      = evidenceHash;
        totalResolved++;

        uint256 totalPaid;
        uint256 totalFees;

        if (winnerSide == SIDE_CREATOR) {
            (uint256 paid, uint256 fees) = _payWinner(
                claimId,
                claim.creator,
                claim.creatorStake + claim.totalChallengerStake,
                claim.creatorStake,
                claimReferrer[claimId]
            );
            totalPaid += paid;
            totalFees += fees;
            wins[claim.creator]++;
            for (uint256 i = 0; i < claim.challengerCount; i++) {
                losses[challengerAddresses[_chKey(claimId, i)]]++;
            }

        } else if (winnerSide == SIDE_CHALLENGERS) {
            bool isFixed      = _strEq(claim.oddsMode, "fixed");
            uint256 remainder = claim.creatorStake;

            for (uint256 i = 0; i < claim.challengerCount; i++) {
                uint256 key      = _chKey(claimId, i);
                address ch       = challengerAddresses[key];
                uint256 chStake  = challengerStakes[key];
                uint256 payout;

                if (isFixed) {
                    payout = _grossPayout(chStake, claim.challengerPayoutBps);
                    uint256 profit = payout > chStake ? payout - chStake : 0;
                    remainder = remainder > profit ? remainder - profit : 0;
                } else {
                    // Pool: proportional share of creator stake
                    uint256 share = (chStake * claim.creatorStake) / claim.totalChallengerStake;
                    payout = chStake + share;
                }

                (uint256 paid, uint256 fees) = _payWinner(
                    claimId, ch, payout, chStake, challengerReferrer[key]
                );
                totalPaid += paid;
                totalFees += fees;
                wins[ch]++;
            }

            losses[claim.creator]++;
            if (isFixed && remainder > 0) {
                // Unspent creator liquidity, returned at cost: not a profit, not fee'd.
                _transfer(claim.creator, remainder);
                totalPaid += remainder;
            }

        } else {
            // Draw / unresolvable: every net stake back, nothing more taken
            // (the entry fee was earned when the position was opened).
            _transfer(claim.creator, claim.creatorStake);
            totalPaid += claim.creatorStake;
            for (uint256 i = 0; i < claim.challengerCount; i++) {
                uint256 key = _chKey(claimId, i);
                _transfer(challengerAddresses[key], challengerStakes[key]);
                totalPaid += challengerStakes[key];
            }
        }

        emit ClaimResolved(claimId, winnerSide, summary, confidence, evidenceHash);
        emit MarketSettled(claimId, totalPaid, totalFees);
    }

    // ── Write: cancel ─────────────────────────────────────────────────────────
    function cancelClaim(uint256 claimId) external nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(msg.sender == claim.creator, "Mimir: not creator");
        require(claim.state == ST_OPEN, "Mimir: not open");

        claim.state = ST_CANCELLED;
        _transfer(claim.creator, claim.creatorStake);
        emit ClaimCancelled(claimId);
    }

    // ── View: claim data ──────────────────────────────────────────────────────
    function getClaim(uint256 claimId) external view returns (
        address creator,
        string  memory question,
        string  memory creatorPosition,
        string  memory counterPosition,
        string  memory resolutionUrl,
        uint256 creatorStake,
        uint256 totalChallengerStake,
        uint256 reservedCreatorLiability,
        uint256 deadline,
        uint8   state,
        uint8   winnerSide,
        string  memory resolutionSummary,
        uint8   confidence,
        string  memory category,
        uint256 parentId,
        uint256 challengerCount,
        uint256 createdAt,
        bytes32 evidenceHash
    ) {
        Claim storage c = claims[claimId];
        return (
            c.creator, c.question, c.creatorPosition, c.counterPosition,
            c.resolutionUrl, c.creatorStake, c.totalChallengerStake,
            c.reservedCreatorLiability, c.deadline, c.state, c.winnerSide,
            c.resolutionSummary, c.confidence, c.category,
            c.parentId, c.challengerCount, c.createdAt, c.evidenceHash
        );
    }

    function getClaimMarketConfig(uint256 claimId) external view returns (
        string  memory marketType,
        string  memory oddsMode,
        uint256 challengerPayoutBps,
        string  memory handicapLine,
        string  memory settlementRule,
        uint256 maxChallengers,
        bool    isPrivate,
        uint256 reservedCreatorLiability
    ) {
        Claim storage c = claims[claimId];
        return (
            c.marketType, c.oddsMode, c.challengerPayoutBps,
            c.handicapLine, c.settlementRule, c.maxChallengers,
            c.isPrivate, c.reservedCreatorLiability
        );
    }

    /// Entry fees taken on this claim so far, and the creator's referrer.
    function getClaimFees(uint256 claimId) external view returns (uint256 entryFees, address creatorReferrer) {
        return (claimEntryFees[claimId], claimReferrer[claimId]);
    }

    function getChallenger(uint256 claimId, uint256 index) external view returns (
        address challenger,
        uint256 stake
    ) {
        uint256 key = _chKey(claimId, index);
        return (challengerAddresses[key], challengerStakes[key]);
    }

    function getChallengerList(uint256 claimId) external view returns (
        address[] memory addrs,
        uint256[] memory stakes
    ) {
        uint256 count = claims[claimId].challengerCount;
        addrs  = new address[](count);
        stakes = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 key = _chKey(claimId, i);
            addrs[i]  = challengerAddresses[key];
            stakes[i] = challengerStakes[key];
        }
    }

    function getUserStats(address user) external view returns (
        uint256 userWins,
        uint256 userLosses
    ) {
        return (wins[user], losses[user]);
    }

    function getPlatformStats() external view returns (
        uint256 totalClaims,
        uint256 resolved,
        uint256 balance
    ) {
        return (claimCount, totalResolved, address(this).balance);
    }

    /// Accrued minus claimed must always be covered by the contract balance.
    function getFeeStats() external view returns (
        uint256 accrued,
        uint256 claimed,
        uint256 outstanding
    ) {
        return (lifetimeFeesAccrued, lifetimeFeesClaimed, lifetimeFeesAccrued - lifetimeFeesClaimed);
    }

    // ── Internal ──────────────────────────────────────────────────────────────
    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    // Fallback: reject accidental USDC sends without a function call
    receive() external payable {
        revert("Mimir: use createClaim or challengeClaim");
    }
}
